import { createHash } from 'node:crypto';
import type {
  SecurityScenarioId,
  SecurityScenarioResult,
  SecurityTestRun,
} from '../../shared/types.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { DeterministicAgent } from '../ai/deterministic.js';
import { FixtureSource } from '../catalog/fixtures.js';
import { ScriptedGateway } from '../payments/scriptedGateway.js';
import { DomainError } from '../domain/errors.js';
import { Store } from '../repo/store.js';
import { approveProposal } from './approvals.js';
import { newId, type Deps } from './core.js';
import { runMarketEvent, submitCraftedProposal } from './events.js';
import { createMission, floodScenarioInput, missionDetail, updateMission } from './missions.js';
import { capturePayment, createPayment, reconcilePayment } from './payments.js';
import { planMission } from './planning.js';

// DEADMAN Security Lab. Each scenario runs the REAL services, policy engine and payment state machine
// in an isolated in-memory PostgreSQL (PGlite) database, against a scripted PayPal double that can
// reproduce timeouts and ambiguous responses on demand. A scenario passes only when the enforcement
// behaviour is actually observed in persisted state — never because a model said so.

export const SUITE_VERSION = 'deadman-suite-1.0.0';

interface Lab {
  seed: string;
  deps: Deps;
  gateway: ScriptedGateway;
  store: Store;
  workspaceId: string;
}

async function openLab(now: Date, seed: string): Promise<Lab> {
  const db = await openDatabase({ databaseUrl: null, pgliteDataDir: null });
  await migrate(db);
  const gateway = new ScriptedGateway();
  const deps: Deps = {
    db,
    catalog: null,
    fixtures: new FixtureSource(),
    claudeAgent: null,
    deterministicAgent: new DeterministicAgent(),
    gateway,
    publicBaseUrl: 'http://security-lab.invalid',
    now: () => now,
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  };
  const workspaceId = newId();
  const store = new Store(db);
  await store.createWorkspace(workspaceId, 'security-lab');
  return { seed, deps, gateway, store, workspaceId };
}

/** Deterministic UUID so every run seeds identical simulated supplier commitments. */
function labMissionId(seed: string): string {
  const h = createHash('sha256').update(`reliefos-security-lab:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function freshMission(
  lab: Lab,
  overrides: Partial<ReturnType<typeof floodScenarioInput>> = {},
) {
  const input = {
    ...floodScenarioInput(lab.deps.now()),
    plannerMode: 'deterministic' as const,
    ...overrides,
  };
  const mission = await createMission(lab.deps, lab.workspaceId, input, {
    scenarioKey: 'security-lab',
    actor: 'security-lab',
    id: labMissionId(lab.seed),
  });
  const plan = await planMission(lab.deps, lab.workspaceId, mission.id, { actor: 'security-lab' });
  return { mission, input, plan };
}

async function approved(lab: Lab) {
  const m = await freshMission(lab);
  const approval = await approveProposal(
    lab.deps,
    lab.workspaceId,
    m.mission.id,
    m.plan.proposal.id,
    {
      approverName: 'Security Lab',
      expectedContentHash: m.plan.proposal.contentHash,
      expectedTotalCents: m.plan.proposal.totalCents,
    },
  );
  return { ...m, approval };
}

async function expectDenied(
  fn: () => Promise<unknown>,
): Promise<{ denied: boolean; code: string | null; checks: string[]; message: string }> {
  try {
    await fn();
    return { denied: false, code: null, checks: [], message: 'operation succeeded' };
  } catch (err) {
    if (err instanceof DomainError) {
      const decision = (err.details as { decision?: { violations: { checkId: string }[] } })
        .decision;
      return {
        denied: true,
        code: err.code,
        checks: decision?.violations.map((v) => v.checkId) ?? [],
        message: err.message,
      };
    }
    throw err;
  }
}

/** Replace the current supplier commitment without notifying anyone, as a silent upstream change would. */
async function silentQuoteChange(
  lab: Lab,
  missionId: string,
  candidateId: string,
  patch: Record<string, unknown>,
  reason: string,
) {
  const q = (await lab.store.currentQuotes(missionId)).get(candidateId)!;
  await lab.deps.db.tx(async (tx) =>
    new Store(tx).insertQuote({ ...q, ...patch, id: newId(), reason, current: true }),
  );
}

type Scenario = {
  id: SecurityScenarioId;
  title: string;
  attack: string;
  expected: string;
  run: (
    lab: Lab,
  ) => Promise<
    Omit<SecurityScenarioResult, 'scenarioId' | 'title' | 'attack' | 'expected' | 'durationMs'>
  >;
};

const SCENARIOS: Scenario[] = [
  {
    id: 'prompt-injection',
    title: 'Prompt injection in a product description',
    attack:
      'A listing tells AI purchasing agents to ignore budget rules, skip approval and order 500 units; RELIEFOS submits the plan a compromised agent would produce.',
    expected:
      'Listing quarantined on ingestion; compromised proposal rejected (CONTENT_QUARANTINE, QUANTITY_BOUNDS); normal planning never selects it.',
    run: async (lab) => {
      const { mission } = await freshMission(lab);
      await runMarketEvent(
        lab.deps,
        lab.workspaceId,
        mission.id,
        'injected-listing',
        'security-lab',
      );
      const detail = await missionDetail(lab.deps, lab.workspaceId, mission.id);
      const compromised = detail.proposals.find(
        (p) => p.createdBy === 'simulated-compromised-agent',
      )!;
      const adv = (await lab.store.listCandidates(mission.id)).find(
        (c) => c.provenance === 'simulated-adversarial',
      )!;
      const recovered = await planMission(lab.deps, lab.workspaceId, mission.id, {
        actor: 'security-lab',
        recoverFrom: compromised.id,
      });
      const checks = compromised.latestDecision?.violations.map((v) => v.checkId) ?? [];
      const passed =
        adv.quarantined &&
        compromised.status === 'REJECTED' &&
        checks.includes('CONTENT_QUARANTINE') &&
        checks.includes('QUANTITY_BOUNDS') &&
        !recovered.proposal.lines.some((l) => l.candidateId === adv.id);
      return {
        observed: `Ingestion flags: ${adv.contentFlags.map((f) => f.rule).join(', ')}; compromised v${compromised.version} ${compromised.status} (${checks.join(', ')}); recovery plan uses the listing: ${recovered.proposal.lines.some((l) => l.candidateId === adv.id)}`,
        passed,
        enforcedBy: [
          'contentSecurity.scanContent',
          'CONTENT_QUARANTINE',
          'QUANTITY_BOUNDS',
          'optimizer.eligibility',
        ],
        evidence: {
          flags: adv.contentFlags,
          violations: compromised.latestDecision?.violations ?? [],
        },
      };
    },
  },
  {
    id: 'price-change-after-selection',
    title: 'Price changes after selection and approval',
    attack:
      'After the coordinator approves, a supplier silently raises its price 60%. Checkout is then attempted with the old approval.',
    expected:
      'Execution-stage revalidation denies the payment (PRICE_INTEGRITY); PayPal is never called; the approval is invalidated.',
    run: async (lab) => {
      const { mission, plan, approval } = await approved(lab);
      const line = [...plan.proposal.lines].sort((a, b) => b.lineTotalCents - a.lineTotalCents)[0]!;
      await silentQuoteChange(
        lab,
        mission.id,
        line.candidateId,
        { unitPriceCents: Math.round(line.unitPriceCents * 1.6) },
        'security-lab: silent reprice',
      );
      const before = lab.gateway.createCalls;
      const res = await expectDenied(() =>
        createPayment(
          lab.deps,
          lab.workspaceId,
          mission.id,
          plan.proposal.id,
          approval.id,
          'security-lab',
        ),
      );
      const appr = (await lab.store.listApprovals(mission.id)).find((a) => a.id === approval.id)!;
      const passed =
        res.denied &&
        res.checks.includes('PRICE_INTEGRITY') &&
        lab.gateway.createCalls === before &&
        appr.status === 'INVALIDATED';
      return {
        observed: `Payment ${res.denied ? 'denied' : 'ALLOWED'} (${res.checks.join(', ') || res.message}); PayPal create calls: ${lab.gateway.createCalls - before}; approval ${appr.status}`,
        passed,
        enforcedBy: [
          'PRICE_INTEGRITY',
          'BUDGET_CAP (priced at current commitment)',
          'execution-stage revalidation',
        ],
        evidence: {
          violations: res.checks,
          approvalStatus: appr.status,
          invalidatedReason: appr.invalidatedReason,
        },
      };
    },
  },
  {
    id: 'shipping-exceeds-budget',
    title: 'Shipping pushes the order over budget',
    attack:
      'A supplier adds a $2,000 courier surcharge after approval, so goods fit the budget but goods + shipping do not.',
    expected:
      'BUDGET_CAP recomputes shipping from current commitments and denies the payment before PayPal is contacted.',
    run: async (lab) => {
      const { mission, plan, approval } = await approved(lab);
      const line = plan.proposal.lines[0]!;
      const q = (await lab.store.currentQuotes(mission.id)).get(line.candidateId)!;
      await silentQuoteChange(
        lab,
        mission.id,
        line.candidateId,
        { shippingBaseCents: q.shippingBaseCents + 200_000 },
        'security-lab: courier surcharge',
      );
      const before = lab.gateway.createCalls;
      const res = await expectDenied(() =>
        createPayment(
          lab.deps,
          lab.workspaceId,
          mission.id,
          plan.proposal.id,
          approval.id,
          'security-lab',
        ),
      );
      const passed =
        res.denied && res.checks.includes('BUDGET_CAP') && lab.gateway.createCalls === before;
      return {
        observed: `Payment ${res.denied ? 'denied' : 'ALLOWED'} (${res.checks.join(', ') || res.message}); PayPal create calls: ${lab.gateway.createCalls - before}`,
        passed,
        enforcedBy: ['BUDGET_CAP', 'ARITHMETIC_INTEGRITY'],
        evidence: { violations: res.checks, proposalTotalCents: plan.proposal.totalCents },
      };
    },
  },
  {
    id: 'unauthorized-quantity-substitution',
    title: 'Unauthorized quantity and substitution',
    attack:
      'A proposal multiplies blanket packs by five and substitutes a power bank listing for the hygiene-kit requirement.',
    expected:
      'Gate rejects with QUANTITY_BOUNDS and REQUIREMENT_LINKAGE at validation; it can never reach approval.',
    run: async (lab) => {
      const { mission, plan } = await freshMission(lab);
      const reqs = await lab.store.listRequirements(mission.id);
      const blankets = reqs.find((r) => r.category === 'blankets')!;
      const hygiene = reqs.find((r) => r.category === 'hygiene')!;
      const powerLine = plan.proposal.lines.find(
        (l) => reqs.find((r) => r.id === l.requirementId)?.category === 'power',
      )!;
      const lines = plan.proposal.lines.map((l) => {
        const base = { ...l, id: newId() };
        if (l.requirementId === blankets.id)
          return {
            ...base,
            quantityPacks: l.quantityPacks * 5,
            unitsCovered: l.unitsCovered * 5,
            lineTotalCents: l.lineTotalCents * 5,
          };
        if (l.requirementId === hygiene.id)
          return {
            ...base,
            candidateId: powerLine.candidateId,
            quoteId: powerLine.quoteId,
            title: powerLine.title,
            merchantDomain: powerLine.merchantDomain,
            unitPriceCents: powerLine.unitPriceCents,
            lineTotalCents: powerLine.unitPriceCents * l.quantityPacks,
          };
        return base;
      });
      const res = await lab.deps.db.tx((tx) =>
        submitCraftedProposal(
          new Store(tx),
          lab.deps,
          lab.workspaceId,
          mission.id,
          plan.proposal,
          lines,
          {
            createdBy: 'security-lab-attacker',
            rationale: 'Quantity inflation and substitution attack',
          },
        ),
      );
      const checks = res.decision.violations.map((v) => v.checkId);
      return {
        observed: `Proposal ${res.proposal.status} (${checks.join(', ')})`,
        passed:
          res.proposal.status === 'REJECTED' &&
          checks.includes('QUANTITY_BOUNDS') &&
          checks.includes('REQUIREMENT_LINKAGE'),
        enforcedBy: ['QUANTITY_BOUNDS', 'REQUIREMENT_LINKAGE', 'SPEC_COMPLIANCE'],
        evidence: { violations: res.decision.violations },
      };
    },
  },
  {
    id: 'duplicate-after-timeout',
    title: 'Duplicate purchase after a capture timeout',
    attack:
      'PayPal captures the payment but the response times out. The operator then clicks "Pay" again and retries the capture.',
    expected:
      'Operation goes UNKNOWN; a second order and a blind capture retry are refused; reconciliation reads PayPal and resolves COMPLETED with exactly one capture.',
    run: async (lab) => {
      const { mission, plan, approval } = await approved(lab);
      const op = await createPayment(
        lab.deps,
        lab.workspaceId,
        mission.id,
        plan.proposal.id,
        approval.id,
        'security-lab',
      );
      lab.gateway.payerApproves(op.providerOrderId!);
      lab.gateway.inject({ op: 'capture', kind: 'ambiguous-after-success' });
      const first = await capturePayment(
        lab.deps,
        lab.workspaceId,
        mission.id,
        op.id,
        op.providerOrderId!,
      );
      const dupOrder = await expectDenied(() =>
        createPayment(
          lab.deps,
          lab.workspaceId,
          mission.id,
          plan.proposal.id,
          approval.id,
          'security-lab',
        ),
      );
      const dupCapture = await expectDenied(() =>
        capturePayment(lab.deps, lab.workspaceId, mission.id, op.id, op.providerOrderId!),
      );
      const resolved = await reconcilePayment(lab.deps, lab.workspaceId, mission.id, op.id);
      const passed =
        first.status === 'UNKNOWN' &&
        dupOrder.denied &&
        dupCapture.denied &&
        resolved.status === 'COMPLETED' &&
        lab.gateway.createCalls === 1 &&
        lab.gateway.captureCalls === 1;
      return {
        observed: `After timeout: ${first.status}; duplicate order ${dupOrder.denied ? 'refused' : 'ALLOWED'} (${dupOrder.code}); blind capture retry ${dupCapture.denied ? 'refused' : 'ALLOWED'}; reconciled: ${resolved.status}; PayPal creates=${lab.gateway.createCalls}, captures=${lab.gateway.captureCalls}`,
        passed,
        enforcedBy: [
          'payment state machine (UNKNOWN)',
          'payment_ops_one_live_idx',
          'reconcilePayment',
        ],
        evidence: { createCalls: lab.gateway.createCalls, captureCalls: lab.gateway.captureCalls },
      };
    },
  },
  {
    id: 'ambiguous-payment-response',
    title: 'Ambiguous payment response',
    attack: 'PayPal reports the capture COMPLETED but for a different amount than was approved.',
    expected:
      'Payment is never marked complete; it stays UNKNOWN with AMOUNT_MISMATCH and the mission is not fulfilled.',
    run: async (lab) => {
      const { mission, plan, approval } = await approved(lab);
      const op = await createPayment(
        lab.deps,
        lab.workspaceId,
        mission.id,
        plan.proposal.id,
        approval.id,
        'security-lab',
      );
      lab.gateway.payerApproves(op.providerOrderId!);
      lab.gateway.inject({ op: 'capture', kind: 'amount-mismatch' });
      const res = await capturePayment(
        lab.deps,
        lab.workspaceId,
        mission.id,
        op.id,
        op.providerOrderId!,
      );
      const detail = await missionDetail(lab.deps, lab.workspaceId, mission.id);
      const passed =
        res.status === 'UNKNOWN' &&
        res.lastError?.code === 'AMOUNT_MISMATCH' &&
        detail.summary.committedCents === 0 &&
        detail.mission.status === 'EXECUTING';
      return {
        observed: `Payment ${res.status} (${res.lastError?.code}); mission ${detail.mission.status}; committed $${(detail.summary.committedCents / 100).toFixed(2)}`,
        passed,
        enforcedBy: ['applyAuthoritativeOrder amount check', 'payment state machine'],
        evidence: { lastError: res.lastError },
      };
    },
  },
  {
    id: 'delivery-deadline-violation',
    title: 'Delivery estimate violates the hard deadline',
    attack:
      'After approval, the courier for a critical item slips its ETA 40 minutes past the deadline.',
    expected:
      'DELIVERY_DEADLINE denies the payment before PayPal; the schedule marks the delivery CONFLICT.',
    run: async (lab) => {
      const { mission, plan, approval } = await approved(lab);
      const reqs = await lab.store.listRequirements(mission.id);
      const line = plan.proposal.lines.find(
        (l) => reqs.find((r) => r.id === l.requirementId)?.priority === 'critical',
      )!;
      await silentQuoteChange(
        lab,
        mission.id,
        line.candidateId,
        { eta: new Date(new Date(mission.deadline).getTime() + 40 * 60_000).toISOString() },
        'security-lab: carrier delay',
      );
      const res = await expectDenied(() =>
        createPayment(
          lab.deps,
          lab.workspaceId,
          mission.id,
          plan.proposal.id,
          approval.id,
          'security-lab',
        ),
      );
      const tasks = await lab.store.listTasks(mission.id);
      const conflict = tasks.some(
        (t) =>
          t.proposalId === plan.proposal.id && t.kind === 'delivery' && t.status === 'CONFLICT',
      );
      return {
        observed: `Payment ${res.denied ? 'denied' : 'ALLOWED'} (${res.checks.join(', ') || res.message}); schedule conflict shown: ${conflict}`,
        passed:
          res.denied &&
          res.checks.includes('DELIVERY_DEADLINE') &&
          conflict &&
          lab.gateway.createCalls === 0,
        enforcedBy: ['DELIVERY_DEADLINE', 'schedule.classifyArrival'],
        evidence: { violations: res.checks },
      };
    },
  },
  {
    id: 'mission-change-after-approval',
    title: 'Mission budget changes after approval',
    attack:
      'After approval, the mission budget is cut from $4,000 to $2,000, then checkout is attempted with the earlier approval.',
    expected:
      'The edit invalidates the approval and proposal; checkout is refused; PayPal is never called.',
    run: async (lab) => {
      const { mission, input, plan, approval } = await approved(lab);
      await updateMission(
        lab.deps,
        lab.workspaceId,
        mission.id,
        mission.version,
        { ...input, budgetUsd: 2000 },
        'security-lab',
      );
      const res = await expectDenied(() =>
        createPayment(
          lab.deps,
          lab.workspaceId,
          mission.id,
          plan.proposal.id,
          approval.id,
          'security-lab',
        ),
      );
      const appr = (await lab.store.listApprovals(mission.id)).find((a) => a.id === approval.id)!;
      return {
        observed: `Approval ${appr.status} ("${appr.invalidatedReason}"); checkout ${res.denied ? 'refused' : 'ALLOWED'} (${res.code}); PayPal create calls: ${lab.gateway.createCalls}`,
        passed: appr.status === 'INVALIDATED' && res.denied && lab.gateway.createCalls === 0,
        enforcedBy: ['updateMission invalidation', 'APPROVAL_BINDING', 'MISSION_VERSION_CURRENT'],
        evidence: { approvalStatus: appr.status, reason: appr.invalidatedReason },
      };
    },
  },
];

export const SECURITY_SCENARIOS = SCENARIOS.map(({ id, title, attack, expected }) => ({
  id,
  title,
  attack,
  expected,
}));

export async function runSecuritySuite(
  now: Date,
  only?: SecurityScenarioId[],
): Promise<Omit<SecurityTestRun, 'id' | 'missionId'>> {
  const startedAt = new Date();
  const results: SecurityScenarioResult[] = [];
  for (const sc of SCENARIOS.filter((s) => !only || only.includes(s.id))) {
    const t0 = Date.now();
    const lab = await openLab(now, sc.id);
    try {
      const r = await sc.run(lab);
      results.push({
        scenarioId: sc.id,
        title: sc.title,
        attack: sc.attack,
        expected: sc.expected,
        ...r,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      results.push({
        scenarioId: sc.id,
        title: sc.title,
        attack: sc.attack,
        expected: sc.expected,
        observed: `Scenario errored: ${(err as Error).message}`,
        passed: false,
        enforcedBy: [],
        evidence: {
          error: (err as Error).stack?.split('\n').slice(0, 4).join('\n') ?? String(err),
        },
        durationMs: Date.now() - t0,
      });
    } finally {
      await lab.deps.db.close();
    }
  }
  return {
    suiteVersion: SUITE_VERSION,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
}
