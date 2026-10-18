import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Mission, PolicyDecision, PolicyStage, Proposal } from '../../shared/types.js';
import { BLOCKING_PAYMENT_STATUSES } from '../../shared/states.js';
import type { Database, Queryable } from '../db/database.js';
import type { MissionAgent } from '../ai/types.js';
import type { ProductSource } from '../catalog/source.js';
import type { PaymentGateway } from '../payments/gateway.js';
import { evaluatePolicy, type PolicyContext } from '../policy/engine.js';
import { Store, type PaymentRow } from '../repo/store.js';

export interface Deps {
  db: Database;
  /** Live catalog (Channel3) when configured; otherwise null and the fixture catalog is used. */
  catalog: ProductSource | null;
  fixtures: ProductSource;
  /** Agent used when a mission asks for Claude; falls back to `deterministicAgent` if null. */
  claudeAgent: MissionAgent | null;
  deterministicAgent: MissionAgent;
  /** PayPal gateway; null when sandbox credentials are not configured (payments disabled, never faked). */
  gateway: PaymentGateway | null;
  publicBaseUrl: string;
  now: () => Date;
  log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>;
}

export const newId = () => randomUUID();

export function agentFor(deps: Deps, mission: Pick<Mission, 'plannerMode'>): MissionAgent {
  return mission.plannerMode === 'claude' && deps.claudeAgent
    ? deps.claudeAgent
    : deps.deterministicAgent;
}

/** Spend held by other proposals' payment operations, and units bought by other executed proposals. */
export async function missionCommitments(
  store: Store,
  missionId: string,
  excludeProposalId: string | null,
) {
  const payments = await store.listPayments(missionId);
  const proposals = await store.listProposals(missionId);
  const committedCents = payments
    .filter(
      (p) => p.proposalId !== excludeProposalId && BLOCKING_PAYMENT_STATUSES.includes(p.status),
    )
    .reduce((s, p) => s + p.amountCents, 0);
  const purchasedUnits: Record<string, number> = {};
  for (const p of proposals) {
    if (p.id === excludeProposalId || p.status !== 'EXECUTED') continue;
    for (const l of p.lines)
      purchasedUnits[l.requirementId] = (purchasedUnits[l.requirementId] ?? 0) + l.unitsCovered;
  }
  return { payments, proposals, committedCents, purchasedUnits };
}

export async function loadPolicyContext(
  store: Store,
  mission: Mission,
  proposal: Proposal,
  stage: PolicyStage,
  extras: { approvalId?: string | null; currentPaymentOpId?: string; now: Date },
): Promise<PolicyContext> {
  const [requirements, candidates, currentQuotes, quotesById, commitments] = await Promise.all([
    store.listRequirements(mission.id),
    store.candidatesByIds([...new Set(proposal.lines.map((l) => l.candidateId))]),
    store.currentQuotes(mission.id),
    store.quotesByIds([...new Set(proposal.lines.map((l) => l.quoteId))]),
    missionCommitments(store, mission.id, proposal.id),
  ]);
  const approval = extras.approvalId
    ? await store.getApproval(mission.id, extras.approvalId)
    : await store.activeApproval(proposal.id);
  return {
    stage,
    now: extras.now,
    mission: {
      id: mission.id,
      status: mission.status,
      version: mission.version,
      budgetCents: mission.budgetCents,
      currency: mission.currency,
      deadline: mission.deadline,
      timezone: mission.timezone,
    },
    requirements,
    proposal,
    candidates: new Map(candidates.map((c) => [c.id, c])),
    currentQuotes,
    quotesById,
    committedCents: commitments.committedCents,
    purchasedUnits: commitments.purchasedUnits,
    approval,
    paymentOps: commitments.payments as PaymentRow[],
    ...(extras.currentPaymentOpId ? { currentPaymentOpId: extras.currentPaymentOpId } : {}),
  };
}

/** Evaluate the DEADMAN gate and persist the decision. */
export async function evaluateAndRecord(store: Store, ctx: PolicyContext): Promise<PolicyDecision> {
  const evaluation = evaluatePolicy(ctx);
  const decision: PolicyDecision = {
    id: newId(),
    missionId: ctx.mission.id,
    proposalId: ctx.proposal.id,
    proposalVersion: ctx.proposal.version,
    contentHash: ctx.proposal.contentHash,
    stage: ctx.stage,
    outcome: evaluation.outcome,
    checks: evaluation.checks,
    violations: evaluation.violations,
    warnings: evaluation.warnings,
    engineVersion: evaluation.engineVersion,
    evaluatedAt: ctx.now.toISOString(),
  };
  await store.insertDecision(decision, {
    missionVersion: ctx.mission.version,
    budgetCents: ctx.mission.budgetCents,
    committedCents: ctx.committedCents,
    approvalId: ctx.approval?.id ?? null,
  });
  return decision;
}

export async function inTx<T>(
  deps: Deps,
  fn: (store: Store, q: Queryable) => Promise<T>,
): Promise<T> {
  return deps.db.tx((q) => fn(new Store(q), q));
}

export const store = (deps: Deps) => new Store(deps.db);
