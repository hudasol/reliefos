import type { MissionInput } from '../../shared/contracts.js';
import type { Mission, MissionDetail, MissionInterpretation, MissionSummary, Proposal } from '../../shared/types.js';
import { toCents } from '../../shared/money.js';
import { isValidTimeZone, utcToZonedParts, zonedToUtc } from '../../shared/time.js';
import { DomainError, illegalState } from '../domain/errors.js';
import { agentFor, inTx, missionCommitments, newId, store, type Deps } from './core.js';

export const FLOOD_SCENARIO_KEY = 'flood-east-shelter';

/** The fictional, repeatable demonstration mission. Values are illustrative, not real commitments. */
export function floodScenarioInput(now: Date): MissionInput {
  const timezone = 'America/New_York';
  return {
    title: 'Riverside flood response — East Shelter resupply',
    organization: 'Harbor County Relief Collective (fictional)',
    narrative:
      'Harbor County Relief Collective needs emergency supplies for 120 people displaced by flooding, including 8 infants, ' +
      'delivered to the East Shelter before 5 PM today. We have a $4,000 budget and a 6-hour planning window. ' +
      'Priorities: drinking water, blankets, hygiene kits, phone chargers and baby supplies.',
    budgetUsd: 4000,
    population: 120,
    infants: 8,
    householdSize: 4,
    coverageDays: 3,
    destination: 'East Shelter',
    date: utcToZonedParts(now, timezone).date,
    startTime: '11:00',
    deadlineTime: '17:00',
    timezone,
    plannerMode: 'claude',
  };
}

function termsFromInput(input: MissionInput) {
  if (!isValidTimeZone(input.timezone)) throw new DomainError('VALIDATION_FAILED', `Unknown time zone ${input.timezone}`);
  return {
    title: input.title,
    organization: input.organization,
    narrative: input.narrative,
    budgetCents: toCents(input.budgetUsd),
    population: input.population,
    infants: input.infants,
    householdSize: input.householdSize,
    coverageDays: input.coverageDays,
    destination: input.destination,
    windowStart: zonedToUtc(input.date, input.startTime, input.timezone).toISOString(),
    deadline: zonedToUtc(input.date, input.deadlineTime, input.timezone).toISOString(),
    plannerMode: input.plannerMode,
  };
}

export async function interpretNarrative(deps: Deps, narrative: string, plannerMode: 'claude' | 'deterministic'): Promise<MissionInterpretation & { error: string | null }> {
  const agent = agentFor(deps, { plannerMode });
  const res = await agent.interpret(narrative);
  const o = res.output;
  const ev = (field: string) => o.evidence.find((e) => e.field === field)?.quote ?? null;
  const field = (name: string, value: string | number | null, fallback?: string | number) => ({
    field: name,
    value: value ?? fallback ?? null,
    evidence: value !== null ? ev(name) : null,
    status: value !== null ? ('extracted' as const) : fallback !== undefined ? ('defaulted' as const) : ('missing' as const),
  });
  return {
    mode: res.mode,
    error: res.error,
    fields: [
      field('organization', o.organization),
      field('population', o.population),
      field('infants', o.infants, 0),
      field('budgetUsd', o.budgetUsd),
      field('deadlineLocalTime', o.deadlineLocalTime),
      field('planningHorizonHours', o.planningHorizonHours),
      field('destination', o.destination),
      field('householdSize', o.householdSize, 4),
      field('coverageDays', o.coverageDays, 3),
      { field: 'categories', value: o.categories.join(', ') || null, evidence: null, status: o.categories.length ? 'extracted' : 'missing' },
    ],
    ambiguities: o.ambiguities,
  };
}

export async function createMission(deps: Deps, workspaceId: string, input: MissionInput, opts: { scenarioKey?: string | null; actor: string }): Promise<Mission> {
  const t = termsFromInput(input);
  const now = deps.now().toISOString();
  const mission: Mission = {
    id: newId(),
    ...t,
    currency: 'USD',
    timezone: input.timezone,
    status: 'DRAFT',
    version: 1,
    catalogSource: deps.catalog ? 'channel3' : 'fixture',
    scenarioKey: opts.scenarioKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return inTx(deps, async (s) => {
    await s.insertMission(workspaceId, mission, null);
    await s.audit({
      workspaceId,
      missionId: mission.id,
      type: 'mission.created',
      actor: opts.actor,
      summary: `Mission created: ${mission.title} (budget $${input.budgetUsd.toLocaleString('en-US')}, ${mission.population} people)`,
      data: { version: 1, budgetCents: mission.budgetCents, deadline: mission.deadline, scenarioKey: mission.scenarioKey },
    });
    return mission;
  });
}

/** Edit mission terms. Bumps the version and invalidates every approval and open proposal. */
export async function updateMission(deps: Deps, workspaceId: string, missionId: string, expectedVersion: number, input: MissionInput, actor: string): Promise<Mission> {
  const t = termsFromInput(input);
  return inTx(deps, async (s) => {
    const m = await s.getMission(workspaceId, missionId, true);
    if (m.status === 'EXECUTING') throw illegalState('Mission terms cannot change while a payment is in progress; resolve the payment first.');
    if (m.status === 'COMPLETED') throw illegalState('A completed mission cannot be edited.');
    if (m.version !== expectedVersion) throw new DomainError('STALE_VERSION', 'Mission was modified by someone else; reload and retry', { expectedVersion, currentVersion: m.version });
    const newVersion = await s.updateMissionTerms(missionId, expectedVersion, t);
    const invalidatedApprovals = await s.invalidateApprovals({ missionId }, `Mission terms changed (v${m.version} → v${newVersion})`);
    const proposals = await s.listProposals(missionId);
    const invalidatedProposals: number[] = [];
    for (const p of proposals) {
      if (p.status === 'VALIDATED' || p.status === 'AWAITING_APPROVAL' || p.status === 'APPROVED') {
        await s.setProposalStatus(p.id, p.status, 'INVALIDATED');
        invalidatedProposals.push(p.version);
      }
    }
    const nextStatus = m.status === 'DRAFT' ? 'DRAFT' : m.status === 'BLOCKED' ? 'BLOCKED' : 'NEEDS_REVIEW';
    await s.setMissionStatus(missionId, m.status, nextStatus);
    await s.audit({
      workspaceId,
      missionId,
      type: 'mission.updated',
      actor,
      summary: `Mission terms changed to v${newVersion}${invalidatedApprovals.length ? `; ${invalidatedApprovals.length} approval(s) invalidated` : ''}`,
      data: {
        fromVersion: m.version,
        toVersion: newVersion,
        budgetCents: { from: m.budgetCents, to: t.budgetCents },
        deadline: { from: m.deadline, to: t.deadline },
        population: { from: m.population, to: t.population },
        invalidatedApprovals,
        invalidatedProposals,
      },
    });
    return s.getMission(workspaceId, missionId);
  });
}

export function pickActiveProposal(proposals: Proposal[]): Proposal | null {
  const open = proposals.find((p) => ['AWAITING_APPROVAL', 'APPROVED', 'EXECUTION_PENDING', 'UNKNOWN', 'VALIDATED'].includes(p.status));
  return open ?? proposals[0] ?? null;
}

export async function missionDetail(deps: Deps, workspaceId: string, missionId: string): Promise<MissionDetail> {
  const s = store(deps);
  const mission = await s.getMission(workspaceId, missionId);
  const [requirements, approvals, commitments] = await Promise.all([s.listRequirements(missionId), s.listApprovals(missionId), missionCommitments(s, missionId, null)]);
  const { proposals, payments } = commitments;
  const activeProposal = pickActiveProposal(proposals);

  const committedCents = payments.filter((p) => p.status === 'COMPLETED').reduce((a, p) => a + p.amountCents, 0);
  const pendingCents = payments.filter((p) => p.status !== 'COMPLETED' && ['NOT_CREATED', 'CREATED', 'APPROVAL_PENDING', 'CAPTURE_PENDING', 'PROVIDER_PENDING', 'UNKNOWN'].includes(p.status)).reduce((a, p) => a + p.amountCents, 0);
  const purchased = commitments.purchasedUnits;
  const covered = requirements.filter((r) => (purchased[r.id] ?? 0) >= r.quantity).length;
  const openGaps = requirements
    .filter((r) => (purchased[r.id] ?? 0) < r.quantity)
    .map((r) => ({
      requirementId: r.id,
      label: r.label,
      neededUnits: r.quantity,
      plannedUnits: purchased[r.id] ?? 0,
      shortfallUnits: r.quantity - (purchased[r.id] ?? 0),
      reason: (purchased[r.id] ?? 0) > 0 ? 'Partially purchased' : 'Not yet purchased',
    }));
  const unresolved = payments.filter((p) => p.status === 'UNKNOWN' || p.status === 'PROVIDER_PENDING').length;

  const nextAction = ((): MissionSummary['nextAction'] => {
    if (unresolved) return { code: 'RECONCILE', label: 'Reconcile the unresolved PayPal payment before any further purchase' };
    switch (mission.status) {
      case 'DRAFT':
        return { code: 'PLAN', label: 'Generate a procurement plan' };
      case 'PLANNING':
        return { code: 'WAIT', label: 'Planning in progress' };
      case 'NEEDS_REVIEW':
        return activeProposal && ['REJECTED', 'INVALIDATED', 'FAILED'].includes(activeProposal.status)
          ? { code: 'RECOVER', label: 'Review the policy rejection and generate a recovery plan' }
          : { code: 'PLAN', label: 'Re-plan against the current mission terms' };
      case 'READY_FOR_APPROVAL':
        return activeProposal?.status === 'APPROVED'
          ? { code: 'PAY', label: 'Execute the approved purchase through PayPal' }
          : { code: 'APPROVE', label: 'Review and approve the validated proposal' };
      case 'EXECUTING':
        return { code: 'PAY', label: 'Complete the PayPal checkout' };
      case 'PARTIALLY_FULFILLED':
        return { code: 'PLAN', label: 'Plan procurement for the remaining gaps' };
      case 'COMPLETED':
        return { code: 'DONE', label: 'All requirements purchased; track deliveries' };
      case 'BLOCKED':
        return { code: 'EDIT', label: 'No feasible plan: adjust budget, deadline or quantities' };
    }
  })();

  return {
    mission,
    summary: {
      budgetCents: mission.budgetCents,
      committedCents,
      pendingCents,
      remainingCents: mission.budgetCents - committedCents - pendingCents,
      plannedCents: activeProposal && !['EXECUTED', 'REJECTED', 'INVALIDATED', 'FAILED'].includes(activeProposal.status) ? activeProposal.totalCents : 0,
      requirementsTotal: requirements.length,
      requirementsCovered: covered,
      coveragePct: requirements.length ? Math.round((covered / requirements.length) * 100) : 0,
      openGaps,
      nextAction,
      unresolvedPayments: unresolved,
    },
    requirements,
    activeProposal,
    proposals,
    approvals,
    payments: payments.map(({ createRequestId: _c, captureRequestId: _r, attempts: _a, ...p }) => p),
  };
}
