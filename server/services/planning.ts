import type { Mission, PolicyDecision, ProductCandidate, Proposal, Requirement } from '../../shared/types.js';
import { toCents } from '../../shared/money.js';
import type { Explanation, SelectionOption } from '../ai/types.js';
import { checkSpec, parseAttributes, parsePack } from '../catalog/evidence.js';
import { isBlocking, sanitizeForPrompt, scanContent } from '../catalog/contentSecurity.js';
import { simulateQuote } from '../catalog/quotes.js';
import { CatalogError, type RawListing } from '../catalog/source.js';
import { deriveRequirements } from '../domain/requirements.js';
import { illegalState } from '../domain/errors.js';
import { eligibilityReasons, optimizePlan, type PlanResult } from '../planning/optimizer.js';
import { materialTermsHash } from '../planning/hash.js';
import { buildSchedule } from '../schedule/schedule.js';
import type { Store } from '../repo/store.js';
import { agentFor, evaluateAndRecord, inTx, loadPolicyContext, missionCommitments, newId, store, type Deps } from './core.js';

const CATALOG_CACHE_MINUTES = 30;
const PLANNABLE: Mission['status'][] = ['DRAFT', 'PLANNING', 'NEEDS_REVIEW', 'READY_FOR_APPROVAL', 'PARTIALLY_FULFILLED', 'BLOCKED'];

export interface PlanOutcome {
  proposal: Proposal;
  decision: PolicyDecision;
  explanation: Explanation;
  exclusions: PlanResult['exclusions'];
}

// ---- requirements ----------------------------------------------------------------------

async function ensureRequirements(s: Store, mission: Mission): Promise<Requirement[]> {
  if ((await s.requirementsVersion(mission.id)) === mission.version) return s.listRequirements(mission.id);
  const derived = deriveRequirements(mission).map((d, position) => ({ ...d, id: newId(), missionId: mission.id, position }));
  await s.replaceRequirements(mission.id, mission.version, derived);
  return s.listRequirements(mission.id);
}

// ---- catalog retrieval -----------------------------------------------------------------

function evaluateListing(mission: Mission, req: Requirement, l: RawListing, now: Date): ProductCandidate {
  const pack = parsePack(req.category, l.title, l.description);
  const attributes = parseAttributes(l.title, l.description);
  const contentFlags = scanContent({ title: l.title, description: l.description, merchant: l.merchantDomain });
  return {
    id: newId(),
    missionId: mission.id,
    requirementId: req.id,
    provenance: l.provenance,
    sourceProductId: l.sourceProductId,
    title: l.title.slice(0, 300),
    brand: l.brand,
    description: l.description ? l.description.slice(0, 2000) : null,
    imageUrl: l.imageUrl,
    buyUrl: l.buyUrl,
    merchantDomain: l.merchantDomain,
    priceCents: l.price === null ? null : toCents(l.price),
    currency: l.currency,
    listedAvailability: l.availability,
    pack,
    attributes,
    specCheck: checkSpec(req.spec, { title: l.title, description: l.description }, attributes),
    contentFlags,
    quarantined: isBlocking(contentFlags),
    suitability: null,
    retrievedAt: now.toISOString(),
  };
}

async function retrieveCandidates(deps: Deps, workspaceId: string, mission: Mission, requirements: Requirement[], refresh: boolean) {
  const s = store(deps);
  const now = deps.now();
  const existing = await s.listCandidates(mission.id);
  const quotes = await s.currentQuotes(mission.id);
  let usedFallback = false;
  for (const req of requirements) {
    const mine = existing.filter((c) => c.requirementId === req.id && c.provenance !== 'simulated-adversarial');
    const fresh = mine.some((c) => now.getTime() - new Date(c.retrievedAt).getTime() < CATALOG_CACHE_MINUTES * 60_000);
    if (mine.length > 0 && fresh && !refresh) continue;

    let listings: RawListing[] = [];
    let source = deps.catalog ? 'channel3' : 'fixture';
    let fallbackReason: string | null = null;
    if (deps.catalog) {
      try {
        listings = await deps.catalog.search({ query: req.searchQuery, limit: 12, category: req.category });
        if (listings.length === 0) fallbackReason = 'Channel3 returned no results';
      } catch (err) {
        fallbackReason = err instanceof CatalogError ? err.message : `Channel3 error: ${(err as Error).message}`;
      }
    }
    if (!deps.catalog || fallbackReason) {
      listings = await deps.fixtures.search({ query: req.searchQuery, limit: 12, category: req.category });
      if (deps.catalog) {
        usedFallback = true;
        source = 'fixture';
      }
    }

    const saved: ProductCandidate[] = [];
    for (const l of listings) saved.push(await s.upsertCandidate(evaluateListing(mission, req, l, now), l.raw));

    // Attach a simulated supplier commitment to every priceable, sized listing that lacks one.
    const window = new Date(mission.windowStart);
    for (const c of saved) {
      if (quotes.has(c.id) || c.priceCents === null || !c.pack.unitsPerPack || !c.merchantDomain) continue;
      const q = simulateQuote({
        // Scenario missions share a seed so the rehearsed demo sees identical simulated commitments.
        missionId: mission.scenarioKey ? `scenario:${mission.scenarioKey}` : mission.id,
        sourceProductId: c.sourceProductId,
        merchantDomain: c.merchantDomain,
        category: req.category,
        priceCents: c.priceCents,
        unitsPerPack: c.pack.unitsPerPack,
        requirementUnits: req.quantity,
        windowStart: window,
      });
      await s.insertQuote({
        id: newId(),
        candidateId: c.id,
        missionId: mission.id,
        simulated: true,
        stockPacks: q.stockPacks,
        unitPriceCents: q.unitPriceCents,
        shippingBaseCents: q.shippingBaseCents,
        shippingPerPackCents: q.shippingPerPackCents,
        dispatchAt: q.dispatchAt.toISOString(),
        eta: q.eta.toISOString(),
        carrier: q.carrier,
        reason: q.reason,
        quotedAt: now.toISOString(),
        current: true,
      });
    }

    await inTx(deps, (tx) =>
      tx.audit({
        workspaceId,
        missionId: mission.id,
        type: fallbackReason && deps.catalog ? 'catalog.fallback' : 'catalog.retrieved',
        actor: `catalog:${source}`,
        summary: fallbackReason && deps.catalog
          ? `${req.label}: Channel3 unavailable (${fallbackReason}); used ${saved.length} labelled fixture listings`
          : `${req.label}: retrieved ${saved.length} ${source} listings (${saved.filter((c) => c.quarantined).length} quarantined, ${saved.filter((c) => !c.specCheck.passed).length} failing spec)`,
        data: { requirementId: req.id, query: req.searchQuery, source, count: saved.length, fallbackReason },
      }),
    );
  }
  if (deps.catalog) await s.setCatalogSource(mission.id, usedFallback ? 'fixture' : 'channel3');
}

// ---- proposal construction ---------------------------------------------------------------

function proposalFromPlan(mission: Mission, plan: PlanResult, version: number, meta: { parentId: string | null; createdBy: string; plannerMode: Proposal['plannerMode']; rationale: string; now: Date }): Proposal {
  const lines = plan.lines.map((l) => ({
    id: newId(),
    requirementId: l.requirementId,
    candidateId: l.candidateId,
    quoteId: l.quoteId,
    title: l.title,
    merchantDomain: l.merchantDomain,
    provenance: l.provenance,
    quantityPacks: l.quantityPacks,
    unitsCovered: l.unitsCovered,
    unitPriceCents: l.unitPriceCents,
    lineTotalCents: l.lineTotalCents,
    eta: l.eta,
  }));
  const contentHash = materialTermsHash({
    missionId: mission.id,
    missionVersion: mission.version,
    currency: mission.currency,
    lines: lines.map((l) => ({ requirementId: l.requirementId, candidateId: l.candidateId, quoteId: l.quoteId, quantityPacks: l.quantityPacks, unitPriceCents: l.unitPriceCents })),
    shipping: plan.shipping,
    subtotalCents: plan.subtotalCents,
    shippingCents: plan.shippingCents,
    totalCents: plan.totalCents,
  });
  return {
    id: newId(),
    missionId: mission.id,
    version,
    status: 'DRAFT',
    parentProposalId: meta.parentId,
    createdBy: meta.createdBy,
    plannerMode: meta.plannerMode,
    rationale: meta.rationale,
    tradeoffs: plan.tradeoffs,
    currency: mission.currency,
    subtotalCents: plan.subtotalCents,
    shippingCents: plan.shippingCents,
    shipping: plan.shipping,
    totalCents: plan.totalCents,
    contentHash,
    missionVersion: mission.version,
    lines,
    gaps: plan.gaps,
    createdAt: meta.now.toISOString(),
    updatedAt: meta.now.toISOString(),
    latestDecision: null,
  };
}

function diffProposals(prev: Proposal | null, next: Proposal): string[] {
  if (!prev) return [];
  const changes: string[] = [];
  const key = (l: Proposal['lines'][number]) => `${l.requirementId}|${l.candidateId}`;
  const prevMap = new Map(prev.lines.map((l) => [key(l), l]));
  const nextMap = new Map(next.lines.map((l) => [key(l), l]));
  for (const [k, l] of prevMap) {
    const n = nextMap.get(k);
    if (!n) changes.push(`Removed ${l.quantityPacks} × "${l.title}" (${l.merchantDomain})`);
    else if (n.quantityPacks !== l.quantityPacks || n.unitPriceCents !== l.unitPriceCents) {
      changes.push(`Changed "${l.title}": ${l.quantityPacks} → ${n.quantityPacks} packs at $${(n.unitPriceCents / 100).toFixed(2)}`);
    }
  }
  for (const [k, n] of nextMap) if (!prevMap.has(k)) changes.push(`Added ${n.quantityPacks} × "${n.title}" (${n.merchantDomain})`);
  const delta = next.totalCents - prev.totalCents;
  changes.push(`Total ${delta >= 0 ? 'up' : 'down'} $${(Math.abs(delta) / 100).toFixed(2)} to $${(next.totalCents / 100).toFixed(2)}`);
  return changes;
}

/** Retire any open proposal the new one supersedes, invalidating its approval. */
async function supersedeOpen(s: Store, missionId: string, exceptId: string, reason: string) {
  for (const p of await s.listProposals(missionId)) {
    if (p.id === exceptId) continue;
    if (p.status === 'VALIDATED' || p.status === 'AWAITING_APPROVAL' || p.status === 'APPROVED') {
      await s.setProposalStatus(p.id, p.status, 'INVALIDATED');
      await s.invalidateApprovals({ missionId, proposalId: p.id }, reason);
    }
  }
}

export async function rebuildSchedule(s: Store, mission: Mission, proposal: Proposal, confirmed: boolean) {
  const tasks = buildSchedule({
    missionId: mission.id,
    destination: mission.destination,
    windowStart: new Date(mission.windowStart),
    deadline: new Date(mission.deadline),
    proposal,
    currentQuotes: await s.currentQuotes(mission.id),
    confirmed,
  });
  await s.replaceTasks(mission.id, proposal.id, tasks);
  return tasks;
}

// ---- planning ----------------------------------------------------------------------------

export async function planMission(
  deps: Deps,
  workspaceId: string,
  missionId: string,
  opts: { actor: string; refreshCatalog?: boolean; recoverFrom?: string | null },
): Promise<PlanOutcome> {
  const s = store(deps);
  const now = deps.now();

  // Phase 1 — transition to PLANNING and (re)derive requirements for the current mission version.
  const { mission, requirements, parent } = await inTx(deps, async (tx) => {
    const m = await tx.getMission(workspaceId, missionId, true);
    if (!PLANNABLE.includes(m.status)) throw illegalState(`Mission is ${m.status}; planning is not permitted now`);
    const unresolved = (await tx.listPayments(missionId)).some((p) => ['UNKNOWN', 'PROVIDER_PENDING', 'CAPTURE_PENDING', 'APPROVAL_PENDING', 'CREATED', 'NOT_CREATED'].includes(p.status));
    if (unresolved) throw illegalState('A payment for this mission is in progress or unresolved; resolve it before re-planning');
    const parentProposal = opts.recoverFrom ? await tx.getProposal(missionId, opts.recoverFrom) : null;
    if (parentProposal && !['REJECTED', 'INVALIDATED', 'FAILED'].includes(parentProposal.status)) {
      throw illegalState(`Recovery applies to a rejected or invalidated proposal; v${parentProposal.version} is ${parentProposal.status}`);
    }
    await tx.setMissionStatus(missionId, m.status, 'PLANNING');
    const reqs = await ensureRequirements(tx, { ...m, status: 'PLANNING' });
    await tx.audit({
      workspaceId,
      missionId,
      type: parentProposal ? 'recovery.started' : 'planning.started',
      actor: opts.actor,
      summary: parentProposal ? `Recovery planning started from rejected v${parentProposal.version}` : `Planning started for ${reqs.length} requirements`,
      data: { missionVersion: m.version, requirements: reqs.map((r) => ({ id: r.id, label: r.label, quantity: r.quantity, unit: r.unit, priority: r.priority })) },
    });
    return { mission: { ...m, status: 'PLANNING' as const }, requirements: reqs, parent: parentProposal };
  });

  try {
    // Phase 2 — product discovery (external calls happen outside any DB transaction).
    await retrieveCandidates(deps, workspaceId, mission, requirements, !!opts.refreshCatalog && !parent);

    const candidates = await s.listCandidates(missionId);
    const quotes = await s.currentQuotes(missionId);
    const options = candidates.map((c) => ({ candidate: c, quote: quotes.get(c.id) ?? null }));
    const deadline = new Date(mission.deadline);
    const commitments = await missionCommitments(s, missionId, null);

    // Phase 3 — buyer agent ranks only listings that already passed the deterministic checks.
    const agent = agentFor(deps, mission);
    const eligible: Record<string, SelectionOption[]> = {};
    for (const o of options) {
      if (eligibilityReasons(o, deadline, mission.timezone).length > 0) continue;
      const req = requirements.find((r) => r.id === o.candidate.requirementId)!;
      (eligible[req.id] ??= []).push({
        candidateId: o.candidate.id,
        title: o.candidate.title,
        merchantDomain: o.candidate.merchantDomain!,
        provenance: o.candidate.provenance,
        costPerUnitCents: Math.round((o.quote!.unitPriceCents + o.quote!.shippingPerPackCents) / o.candidate.pack.unitsPerPack!),
        unit: req.unit,
        eta: o.quote!.eta,
        packEvidence: o.candidate.pack.evidence ?? '',
        description: sanitizeForPrompt(o.candidate.description, 400),
      });
    }
    const selection = await agent.select({
      requirements: requirements.map((r) => ({ id: r.id, label: r.label, category: r.category, quantity: r.quantity, unit: r.unit, priority: r.priority })),
      options: eligible,
    });
    await s.insertAgentRun({
      id: newId(),
      missionId,
      role: parent ? 'recovery' : 'buyer',
      mode: selection.mode,
      model: selection.model,
      inputSummary: `Rank ${Object.values(eligible).reduce((a, l) => a + l.length, 0)} eligible listings across ${requirements.length} requirements`,
      output: selection.output,
      valid: selection.valid,
      error: selection.error,
      latencyMs: selection.latencyMs,
      createdAt: now.toISOString(),
    });

    // The agent may only make the plan stricter: listings it reports as suspicious are quarantined.
    for (const flag of selection.output.suspiciousListings) {
      const c = candidates.find((x) => x.id === flag.candidateId);
      if (c && !c.quarantined) {
        const flags = [...c.contentFlags, { rule: 'agent-reported', field: 'description' as const, excerpt: flag.reason.slice(0, 200), severity: 'block' as const }];
        await s.quarantineCandidate(c.id, flags);
        c.quarantined = true;
        c.contentFlags = flags;
      }
    }
    for (const sel of selection.output.selections) {
      for (const [rank, id] of sel.candidateIds.entries()) {
        await s.setSuitability(id, { score: Math.max(0, 100 - rank * 15), notes: rank === 0 ? sel.rationale : `Ranked #${rank + 1}`, evaluator: selection.mode });
      }
    }

    const preferred = Object.fromEntries(selection.output.selections.map((x) => [x.requirementId, x.candidateIds]));
    const plan = optimizePlan({
      requirements,
      options,
      budgetCents: mission.budgetCents,
      committedCents: commitments.committedCents,
      deadline,
      timeZone: mission.timezone,
      purchasedUnits: commitments.purchasedUnits,
      preferred,
    });

    // Phase 4 — persist the proposal and run the DEADMAN gate, atomically with the status changes.
    const result = await inTx(deps, async (tx) => {
      const m = await tx.getMission(workspaceId, missionId, true);
      const version = await tx.nextProposalVersion(missionId);
      const proposal = proposalFromPlan(m, plan, version, {
        parentId: parent?.id ?? null,
        createdBy: parent ? `recovery-planner:${selection.mode}` : `buyer-agent:${selection.mode}`,
        plannerMode: selection.mode,
        rationale: selection.output.selections.map((x) => x.rationale).filter(Boolean).slice(0, 5).join(' '),
        now,
      });
      await tx.insertProposal(proposal);
      await supersedeOpen(tx, missionId, proposal.id, `Superseded by proposal v${version}`);
      await tx.audit({
        workspaceId,
        missionId,
        type: 'proposal.generated',
        actor: proposal.createdBy,
        summary: `Proposal v${version}: ${proposal.lines.length} lines, $${(proposal.totalCents / 100).toFixed(2)} of $${(m.budgetCents / 100).toFixed(2)}${proposal.gaps.length ? `, ${proposal.gaps.length} gap(s)` : ''}`,
        data: { proposalId: proposal.id, version, totalCents: proposal.totalCents, contentHash: proposal.contentHash, gaps: proposal.gaps, exclusions: plan.exclusions.length },
      });

      if (proposal.lines.length === 0) {
        const ctx = await loadPolicyContext(tx, m, proposal, 'validation', { now });
        const decision = await evaluateAndRecord(tx, ctx);
        await tx.setProposalStatus(proposal.id, 'DRAFT', 'REJECTED');
        await tx.setMissionStatus(missionId, m.status, 'BLOCKED');
        await tx.audit({ workspaceId, missionId, type: 'mission.blocked', actor: 'policy:deadman', summary: 'No feasible plan within the mission constraints', data: { gaps: proposal.gaps } });
        return { proposal: { ...proposal, status: 'REJECTED' as const, latestDecision: decision }, decision };
      }

      const ctx = await loadPolicyContext(tx, m, proposal, 'validation', { now });
      const decision = await evaluateAndRecord(tx, ctx);
      if (decision.outcome === 'ALLOW') {
        await tx.setProposalStatus(proposal.id, 'DRAFT', 'VALIDATED');
        await tx.setProposalStatus(proposal.id, 'VALIDATED', 'AWAITING_APPROVAL');
        await tx.setMissionStatus(missionId, m.status, 'READY_FOR_APPROVAL');
      } else {
        await tx.setProposalStatus(proposal.id, 'DRAFT', 'REJECTED');
        await tx.setMissionStatus(missionId, m.status, 'NEEDS_REVIEW');
      }
      await tx.audit({
        workspaceId,
        missionId,
        type: decision.outcome === 'ALLOW' ? 'policy.allowed' : 'policy.rejected',
        actor: 'policy:deadman',
        summary:
          decision.outcome === 'ALLOW'
            ? `Proposal v${version} passed ${decision.checks.length} policy checks; awaiting human approval`
            : `Proposal v${version} rejected: ${decision.violations.map((v) => v.checkId).join(', ')}`,
        data: { decisionId: decision.id, violations: decision.violations, warnings: decision.warnings },
      });
      const stored = await tx.getProposal(missionId, proposal.id);
      await rebuildSchedule(tx, m, stored, false);
      return { proposal: stored, decision };
    });

    // Phase 5 — explanation for the coordinator (never consulted by the gate).
    const explanation = await explainOutcome(deps, mission, result.proposal, result.decision, parent);
    return { ...result, explanation: explanation.output, exclusions: plan.exclusions };
  } catch (err) {
    // Leave the mission in a reviewable state rather than stuck in PLANNING.
    await inTx(deps, async (tx) => {
      const m = await tx.getMission(workspaceId, missionId, true);
      if (m.status === 'PLANNING') await tx.setMissionStatus(missionId, 'PLANNING', 'NEEDS_REVIEW');
      await tx.audit({ workspaceId, missionId, type: 'planning.failed', actor: 'system', summary: `Planning failed: ${(err as Error).message}`, data: {} });
    }).catch(() => undefined);
    throw err;
  }
}

export async function explainOutcome(deps: Deps, mission: Mission, proposal: Proposal, decision: PolicyDecision, parent: Proposal | null) {
  const agent = agentFor(deps, mission);
  const res = await agent.explain({
    kind: decision.outcome === 'DENY' ? 'rejection' : parent ? 'recovery' : 'approval-ready',
    missionTitle: mission.title,
    violations: decision.violations.map((v) => ({ checkId: v.checkId, message: v.message })),
    warnings: decision.warnings.map((v) => ({ checkId: v.checkId, message: v.message })),
    changes: diffProposals(parent, proposal),
    gaps: proposal.gaps.map((g) => ({ label: g.label, shortfallUnits: g.shortfallUnits, reason: g.reason })),
    totalCents: proposal.totalCents,
    budgetCents: mission.budgetCents,
  });
  await store(deps).insertAgentRun({
    id: newId(),
    missionId: mission.id,
    role: 'explainer',
    mode: res.mode,
    model: res.model,
    inputSummary: `Explain ${decision.outcome} for proposal v${proposal.version}`,
    output: { ...res.output, proposalId: proposal.id, decisionId: decision.id },
    valid: res.valid,
    error: res.error,
    latencyMs: res.latencyMs,
    createdAt: deps.now().toISOString(),
  });
  return res;
}
