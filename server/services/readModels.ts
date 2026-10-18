import type { FulfillmentQuote, ProductCandidate } from '../../shared/types.js';
import { PLANNING_ASSUMPTIONS } from '../domain/requirements.js';
import { eligibilityReasons, INTAKE_BUFFER_MINUTES } from '../planning/optimizer.js';
import { POLICY_CHECK_CATALOG } from '../policy/engine.js';
import { missionCommitments, store, type Deps } from './core.js';
import { missionDetail, pickActiveProposal } from './missions.js';

export interface CandidateView extends ProductCandidate {
  quote: FulfillmentQuote | null;
  eligible: boolean;
  exclusionReasons: string[];
  costPerUnitCents: number | null;
  selectedInActive: boolean;
}

export async function candidateViews(deps: Deps, workspaceId: string, missionId: string): Promise<CandidateView[]> {
  const s = store(deps);
  const mission = await s.getMission(workspaceId, missionId);
  const [candidates, quotes, proposals] = await Promise.all([s.listCandidates(missionId), s.currentQuotes(missionId), s.listProposals(missionId)]);
  const active = pickActiveProposal(proposals);
  const selected = new Set(active?.lines.map((l) => l.candidateId) ?? []);
  const deadline = new Date(mission.deadline);
  return candidates.map((c) => {
    const quote = quotes.get(c.id) ?? null;
    const reasons = eligibilityReasons({ candidate: c, quote }, deadline);
    return {
      ...c,
      quote,
      eligible: reasons.length === 0,
      exclusionReasons: reasons,
      costPerUnitCents: quote && c.pack.unitsPerPack ? Math.round((quote.unitPriceCents + quote.shippingPerPackCents) / c.pack.unitsPerPack) : null,
      selectedInActive: selected.has(c.id),
    };
  });
}

const dollars = (c: number | null | undefined) => (c == null ? null : Math.round(c) / 100);

/** Flat, typed tables for the AG Grid decision centre and the AG Studio dashboard. */
export async function analytics(deps: Deps, workspaceId: string, missionId: string) {
  const s = store(deps);
  const detail = await missionDetail(deps, workspaceId, missionId);
  const { mission, requirements, proposals, payments } = detail;
  const [cands, decisions, tasks, securityRuns, quotes] = await Promise.all([
    candidateViews(deps, workspaceId, missionId),
    s.listDecisions(missionId),
    s.listTasks(missionId),
    s.listSecurityRuns(missionId),
    s.currentQuotes(missionId),
  ]);
  const { purchasedUnits } = await missionCommitments(s, missionId, null);
  const active = detail.activeProposal;
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const deadline = new Date(mission.deadline).getTime();

  const requirementRows = requirements.map((r) => {
    const planned = active && !['REJECTED', 'INVALIDATED', 'FAILED', 'EXECUTED'].includes(active.status)
      ? active.lines.filter((l) => l.requirementId === r.id).reduce((a, l) => a + l.unitsCovered, 0)
      : 0;
    const purchased = purchasedUnits[r.id] ?? 0;
    return {
      id: r.id,
      requirement: r.label,
      category: r.category,
      priority: r.priority,
      needed: r.quantity,
      unit: r.unit,
      purchased,
      planned,
      gap: Math.max(0, r.quantity - purchased - planned),
      coveragePct: Math.min(1, (purchased + planned) / Math.max(1, r.quantity)),
      basis: r.rationale,
    };
  });

  const lineRows = proposals.flatMap((p) =>
    p.lines.map((l) => {
      const q = quotes.get(l.candidateId);
      const eta = new Date(q?.eta ?? l.eta).getTime();
      const task = tasks.find((t) => t.proposalId === p.id && t.lineIds.includes(l.id));
      return {
        id: l.id,
        proposalId: p.id,
        proposalVersion: p.version,
        proposalStatus: p.status,
        isActive: active?.id === p.id,
        requirementId: l.requirementId,
        requirement: reqById.get(l.requirementId)?.label ?? 'Unknown',
        category: reqById.get(l.requirementId)?.category ?? 'unknown',
        priority: reqById.get(l.requirementId)?.priority ?? 'standard',
        product: l.title,
        merchant: l.merchantDomain,
        provenance: l.provenance,
        packs: l.quantityPacks,
        units: l.unitsCovered,
        unitPrice: dollars(l.unitPriceCents),
        currentUnitPrice: dollars(q?.unitPriceCents ?? l.unitPriceCents),
        lineTotal: dollars(l.lineTotalCents),
        eta: new Date(eta).toISOString(),
        slackMinutes: Math.round((deadline - eta) / 60_000) - INTAKE_BUFFER_MINUTES,
        deliveryStatus: task?.status ?? 'PLANNED',
      };
    }),
  );

  const candidateRows = cands.map((c) => ({
    id: c.id,
    requirementId: c.requirementId,
    requirement: reqById.get(c.requirementId)?.label ?? 'Unknown',
    category: reqById.get(c.requirementId)?.category ?? 'unknown',
    product: c.title,
    brand: c.brand,
    merchant: c.merchantDomain,
    provenance: c.provenance,
    listedPrice: dollars(c.priceCents),
    unitsPerPack: c.pack.unitsPerPack,
    packEvidence: c.pack.evidence,
    costPerUnit: c.costPerUnitCents == null ? null : c.costPerUnitCents / 100,
    eta: c.quote?.eta ?? null,
    stockPacks: c.quote?.stockPacks ?? null,
    specPassed: c.specCheck.passed,
    quarantined: c.quarantined,
    eligible: c.eligible,
    selected: c.selectedInActive,
    suitability: c.suitability?.score ?? null,
    exclusion: c.exclusionReasons[0] ?? null,
    exclusionCount: c.exclusionReasons.length,
    buyUrl: c.buyUrl,
    imageUrl: c.imageUrl,
  }));

  const checkRows = decisions.flatMap((d) =>
    d.checks.map((c) => ({
      id: `${d.id}:${c.checkId}`,
      decisionId: d.id,
      proposalVersion: d.proposalVersion,
      stage: d.stage,
      outcome: d.outcome,
      check: c.checkId,
      title: c.title,
      passed: c.passed,
      hard: c.hard,
      detail: c.detail,
      evaluatedAt: d.evaluatedAt,
    })),
  );

  const paymentRows = payments.map((p) => ({
    id: p.id,
    proposalVersion: p.proposalVersion,
    status: p.status,
    amount: dollars(p.amountCents),
    orderId: p.providerOrderId,
    captureId: p.providerCaptureId,
    captureStatus: p.providerCaptureStatus,
    verified: !!p.verifiedAt,
    updatedAt: p.updatedAt,
    error: p.lastError?.message ?? null,
  }));

  const securityRows = (securityRuns[0]?.results ?? []).map((r) => ({
    id: r.scenarioId,
    scenario: r.title,
    passed: r.passed,
    observed: r.observed,
    enforcedBy: r.enforcedBy.join(', '),
    durationMs: r.durationMs,
    runAt: securityRuns[0]!.finishedAt,
  }));

  const spendRows = requirements.map((r) => {
    const activeSpend = active ? active.lines.filter((l) => l.requirementId === r.id).reduce((a, l) => a + l.lineTotalCents, 0) : 0;
    const executedSpend = proposals.filter((p) => p.status === 'EXECUTED').flatMap((p) => p.lines).filter((l) => l.requirementId === r.id).reduce((a, l) => a + l.lineTotalCents, 0);
    return { id: r.id, category: r.category, requirement: r.label, planned: dollars(activeSpend), executed: dollars(executedSpend) };
  });

  return {
    asOf: deps.now().toISOString(),
    mission: { id: mission.id, title: mission.title, status: mission.status, budget: dollars(mission.budgetCents), deadline: mission.deadline, catalogSource: mission.catalogSource },
    summary: detail.summary,
    requirements: requirementRows,
    lines: lineRows,
    candidates: candidateRows,
    checks: checkRows,
    payments: paymentRows,
    security: securityRows,
    spend: spendRows,
  };
}

export async function missionReport(deps: Deps, workspaceId: string, missionId: string) {
  const s = store(deps);
  const detail = await missionDetail(deps, workspaceId, missionId);
  const [tasks, audit, securityRuns, candidates, chain] = await Promise.all([
    s.listTasks(missionId),
    s.listAudit(missionId),
    s.listSecurityRuns(missionId),
    s.listCandidates(missionId),
    s.verifyAuditChain(workspaceId),
  ]);
  const executed = detail.proposals.filter((p) => p.status === 'EXECUTED');
  const provenance = candidates.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.provenance]: (acc[c.provenance] ?? 0) + 1 }), {});
  return {
    mission: detail.mission,
    summary: detail.summary,
    requirements: detail.requirements,
    executedProposals: executed,
    verifiedPayments: detail.payments.filter((p) => p.status === 'COMPLETED' && p.verifiedAt),
    unresolvedPayments: detail.payments.filter((p) => ['UNKNOWN', 'PROVIDER_PENDING'].includes(p.status)),
    confirmedDeliveries: tasks.filter((t) => t.status === 'CONFIRMED'),
    rejectedProposals: detail.proposals.filter((p) => ['REJECTED', 'INVALIDATED'].includes(p.status)).map((p) => ({ version: p.version, status: p.status, createdBy: p.createdBy, violations: p.latestDecision?.violations ?? [] })),
    security: securityRuns[0] ?? null,
    audit: { events: audit.length, chainIntact: chain.intact, chainEvents: chain.events, brokenAt: chain.brokenAt },
    dataProvenance: provenance,
    assumptions: PLANNING_ASSUMPTIONS,
    policyChecks: POLICY_CHECK_CATALOG,
    simulated: [
      'Supplier stock levels, delivery ETAs and courier fees (no merchant fulfilment API is available).',
      'Market disruption drills and the adversarial listing used in drills.',
      'Fixture product listings (.example merchants) whenever Channel3 is not configured or unavailable.',
    ],
  };
}
