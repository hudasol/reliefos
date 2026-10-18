import type {
  Approval,
  FulfillmentQuote,
  PaymentOperation,
  PolicyCheckResult,
  PolicyStage,
  PolicyViolation,
  ProductCandidate,
  Proposal,
  Requirement,
} from '../../shared/types.js';
import type { MissionStatus } from '../../shared/states.js';
import { BLOCKING_PAYMENT_STATUSES, UNRESOLVED_PAYMENT_STATUSES } from '../../shared/states.js';
import { checkSpec, parseAttributes } from '../catalog/evidence.js';
import { isBlocking, scanContent } from '../catalog/contentSecurity.js';
import { computeShipping, INTAKE_BUFFER_MINUTES, type PlannedLine } from '../planning/optimizer.js';
import { materialTermsHash } from '../planning/hash.js';
import { localTime } from '../../shared/time.js';

// DEADMAN — the deterministic policy gate. It is the only component that can permit a payment
// operation. It never consults a language model and never trusts values the planner computed: every
// total, quantity, price, quote and approval binding is re-derived from authoritative state passed in
// by the caller (loaded from the database at evaluation time).

export const POLICY_ENGINE_VERSION = 'deadman-1.0.0';
export const AT_RISK_MINUTES = 45;

export interface PolicyContext {
  stage: PolicyStage;
  now: Date;
  mission: {
    id: string;
    status: MissionStatus;
    version: number;
    budgetCents: number;
    currency: string;
    deadline: string;
    /** IANA zone used only to format human-readable messages. */
    timezone?: string;
  };
  requirements: Requirement[];
  proposal: Proposal;
  candidates: Map<string, ProductCandidate>;
  /** Current (latest) supplier quote per candidate id. */
  currentQuotes: Map<string, FulfillmentQuote>;
  /** Every quote referenced by the proposal lines, by quote id (may be superseded). */
  quotesById: Map<string, FulfillmentQuote>;
  /** Spend committed or held by payment operations of OTHER proposals in this mission. */
  committedCents: number;
  /** Units already bought per requirement by OTHER executed proposals. */
  purchasedUnits: Record<string, number>;
  /** The approval being relied upon (execution and capture stages). */
  approval: Approval | null;
  paymentOps: PaymentOperation[];
  /** At capture stage: the operation being captured (excluded from duplicate detection). */
  currentPaymentOpId?: string;
}

export interface PolicyEvaluation {
  outcome: 'ALLOW' | 'DENY';
  checks: PolicyCheckResult[];
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  engineVersion: string;
}

const ALLOWED_MISSION_STATES: Record<PolicyStage, MissionStatus[]> = {
  validation: ['PLANNING', 'NEEDS_REVIEW', 'READY_FOR_APPROVAL', 'PARTIALLY_FULFILLED'],
  approval: ['READY_FOR_APPROVAL'],
  execution: ['READY_FOR_APPROVAL', 'EXECUTING'],
  capture: ['EXECUTING'],
};

interface CheckDef {
  id: string;
  title: string;
  hard: boolean;
  stages: PolicyStage[];
  run: (ctx: PolicyContext) => { violations: PolicyViolation[]; detail: string };
}

const ALL: PolicyStage[] = ['validation', 'approval', 'execution', 'capture'];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const v = (checkId: string, message: string, lineId: string | null = null, evidence: Record<string, unknown> = {}): PolicyViolation => ({
  checkId,
  message,
  lineId,
  evidence,
});

/**
 * Recompute totals from line quantities. 'proposal' prices each line with the quote it references
 * (internal consistency); 'current' prices it with the supplier's latest commitment (actual cost now).
 */
function recomputedTotals(ctx: PolicyContext, basis: 'proposal' | 'current') {
  const lines: PlannedLine[] = ctx.proposal.lines.map((l) => {
    const q = basis === 'current' ? ctx.currentQuotes.get(l.candidateId) : ctx.quotesById.get(l.quoteId);
    const unitPriceCents = basis === 'current' && q ? q.unitPriceCents : l.unitPriceCents;
    return {
      requirementId: l.requirementId,
      candidateId: l.candidateId,
      quoteId: l.quoteId,
      title: l.title,
      merchantDomain: l.merchantDomain,
      provenance: l.provenance,
      quantityPacks: l.quantityPacks,
      unitsPerPack: ctx.candidates.get(l.candidateId)?.pack.unitsPerPack ?? 0,
      unitsCovered: l.unitsCovered,
      unitPriceCents,
      lineTotalCents: l.quantityPacks * unitPriceCents,
      shippingPerPackCents: q?.shippingPerPackCents ?? 0,
      shippingBaseCents: q?.shippingBaseCents ?? 0,
      eta: q?.eta ?? l.eta,
    };
  });
  const shipping = computeShipping(lines);
  const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const shippingTotal = shipping.reduce((s, c) => s + c.cents, 0);
  return { lines, shipping, subtotal, shippingTotal, total: subtotal + shippingTotal };
}

const CHECKS: CheckDef[] = [
  {
    id: 'MISSION_STATE',
    title: 'Mission is in a state that permits this action',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const allowed = ALLOWED_MISSION_STATES[ctx.stage];
      return allowed.includes(ctx.mission.status)
        ? { violations: [], detail: `Mission ${ctx.mission.status} permits ${ctx.stage}` }
        : {
            violations: [v('MISSION_STATE', `Mission status ${ctx.mission.status} does not permit ${ctx.stage}`, null, { allowed })],
            detail: 'Mission state blocks this action',
          };
    },
  },
  {
    id: 'MISSION_VERSION_CURRENT',
    title: 'Proposal was planned against the current mission terms',
    hard: true,
    stages: ALL,
    run: (ctx) =>
      ctx.proposal.missionVersion === ctx.mission.version
        ? { violations: [], detail: `Mission version ${ctx.mission.version}` }
        : {
            violations: [
              v('MISSION_VERSION_CURRENT', `Mission terms changed after this proposal was planned (v${ctx.proposal.missionVersion} → v${ctx.mission.version})`, null, {
                proposalMissionVersion: ctx.proposal.missionVersion,
                currentMissionVersion: ctx.mission.version,
              }),
            ],
            detail: 'Stale mission version',
          },
  },
  {
    id: 'CURRENCY_MATCH',
    title: 'All amounts are in the mission currency',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      if (ctx.proposal.currency !== ctx.mission.currency) {
        out.push(v('CURRENCY_MATCH', `Proposal currency ${ctx.proposal.currency} ≠ mission currency ${ctx.mission.currency}`));
      }
      for (const l of ctx.proposal.lines) {
        const c = ctx.candidates.get(l.candidateId);
        if (c && c.currency !== ctx.mission.currency) out.push(v('CURRENCY_MATCH', `Listing priced in ${c.currency}`, l.id));
      }
      return { violations: out, detail: out.length ? 'Currency mismatch' : `All amounts in ${ctx.mission.currency}` };
    },
  },
  {
    id: 'REQUIREMENT_LINKAGE',
    title: 'Every line serves a requirement of this mission with a product retrieved for it',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const reqIds = new Set(ctx.requirements.map((r) => r.id));
      const out: PolicyViolation[] = [];
      if (ctx.proposal.lines.length === 0) out.push(v('REQUIREMENT_LINKAGE', 'Proposal has no lines'));
      for (const l of ctx.proposal.lines) {
        const c = ctx.candidates.get(l.candidateId);
        if (!reqIds.has(l.requirementId)) out.push(v('REQUIREMENT_LINKAGE', 'Line does not belong to an active mission requirement', l.id));
        else if (!c) out.push(v('REQUIREMENT_LINKAGE', 'Line references a product that was never retrieved for this mission', l.id));
        else if (c.missionId !== ctx.mission.id || c.requirementId !== l.requirementId) {
          out.push(
            v('REQUIREMENT_LINKAGE', `Unauthorized substitution: "${c.title}" was retrieved for a different requirement`, l.id, {
              candidateRequirement: c.requirementId,
              lineRequirement: l.requirementId,
            }),
          );
        }
      }
      return { violations: out, detail: out.length ? 'Unlinked or substituted lines' : `${ctx.proposal.lines.length} lines linked` };
    },
  },
  {
    id: 'SPEC_COMPLIANCE',
    title: 'Each product independently meets the requirement specification',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const reqs = new Map(ctx.requirements.map((r) => [r.id, r]));
      const out: PolicyViolation[] = [];
      for (const l of ctx.proposal.lines) {
        const c = ctx.candidates.get(l.candidateId);
        const r = reqs.get(l.requirementId);
        if (!c || !r) continue;
        const res = checkSpec(r.spec, c, parseAttributes(c.title, c.description));
        if (!res.passed) out.push(v('SPEC_COMPLIANCE', `"${c.title}" does not meet "${r.label}": ${res.reasons.join('; ')}`, l.id, { reasons: res.reasons }));
      }
      return { violations: out, detail: out.length ? 'Specification failures' : 'All products meet specification' };
    },
  },
  {
    id: 'CONTENT_QUARANTINE',
    title: 'No product listing contains instructions aimed at the purchasing agent',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      for (const l of ctx.proposal.lines) {
        const c = ctx.candidates.get(l.candidateId);
        if (!c) continue;
        const flags = scanContent({ title: c.title, description: c.description, merchant: c.merchantDomain });
        if (c.quarantined || isBlocking(flags)) {
          out.push(
            v('CONTENT_QUARANTINE', `Listing "${c.title}" contains prompt-injection content and is quarantined`, l.id, {
              flags: flags.length ? flags : c.contentFlags,
            }),
          );
        }
      }
      return { violations: out, detail: out.length ? 'Quarantined content present' : 'No injection content detected' };
    },
  },
  {
    id: 'EVIDENCE_PRESENT',
    title: 'Price, pack size and source identifiers are evidenced',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      for (const l of ctx.proposal.lines) {
        const c = ctx.candidates.get(l.candidateId);
        if (!c) continue;
        const missing: string[] = [];
        if (!c.sourceProductId) missing.push('source product id');
        if (c.priceCents === null) missing.push('listed price');
        if (!c.pack.unitsPerPack || !c.pack.evidence) missing.push('pack size evidence');
        if (missing.length) out.push(v('EVIDENCE_PRESENT', `"${c.title}" lacks ${missing.join(', ')}`, l.id, { missing }));
        else if (Math.floor(l.quantityPacks * c.pack.unitsPerPack!) !== l.unitsCovered) {
          out.push(v('EVIDENCE_PRESENT', `Claimed coverage ${l.unitsCovered} does not follow from ${l.quantityPacks} × ${c.pack.unitsPerPack}`, l.id));
        }
      }
      return { violations: out, detail: out.length ? 'Missing evidence' : 'Evidence present for all lines' };
    },
  },
  {
    id: 'PRICE_INTEGRITY',
    title: 'Prices match the current supplier commitment',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      for (const l of ctx.proposal.lines) {
        const q = ctx.currentQuotes.get(l.candidateId);
        if (!q) {
          out.push(v('PRICE_INTEGRITY', `No current supplier commitment for "${l.title}"`, l.id));
          continue;
        }
        if (q.unitPriceCents !== l.unitPriceCents) {
          out.push(
            v('PRICE_INTEGRITY', `Price changed after selection for "${l.title}": ${money(l.unitPriceCents)} → ${money(q.unitPriceCents)} per pack`, l.id, {
              proposedUnitPriceCents: l.unitPriceCents,
              currentUnitPriceCents: q.unitPriceCents,
              quoteId: q.id,
              quoteReason: q.reason,
            }),
          );
        } else if (q.id !== l.quoteId) {
          out.push(v('PRICE_INTEGRITY', `Supplier commitment for "${l.title}" was revised after selection (${q.reason})`, l.id, { proposedQuoteId: l.quoteId, currentQuoteId: q.id }));
        }
      }
      return { violations: out, detail: out.length ? 'Price or quote drift' : 'All prices match current commitments' };
    },
  },
  {
    id: 'ARITHMETIC_INTEGRITY',
    title: 'Declared totals equal independently recomputed totals',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const r = recomputedTotals(ctx, 'proposal');
      const p = ctx.proposal;
      const out: PolicyViolation[] = [];
      for (const l of p.lines) {
        if (l.lineTotalCents !== l.quantityPacks * l.unitPriceCents) {
          out.push(v('ARITHMETIC_INTEGRITY', `Line total ${money(l.lineTotalCents)} ≠ ${l.quantityPacks} × ${money(l.unitPriceCents)}`, l.id));
        }
      }
      if (p.subtotalCents !== r.subtotal || p.shippingCents !== r.shippingTotal || p.totalCents !== r.total) {
        out.push(
          v('ARITHMETIC_INTEGRITY', `Declared total ${money(p.totalCents)} ≠ recomputed ${money(r.total)} (subtotal ${money(r.subtotal)} + shipping ${money(r.shippingTotal)})`, null, {
            declared: { subtotal: p.subtotalCents, shipping: p.shippingCents, total: p.totalCents },
            recomputed: { subtotal: r.subtotal, shipping: r.shippingTotal, total: r.total, shippingByMerchant: r.shipping },
          }),
        );
      }
      return { violations: out, detail: out.length ? 'Totals do not reconcile' : `Recomputed total ${money(r.total)}` };
    },
  },
  {
    id: 'BUDGET_CAP',
    title: 'Total including shipping stays within the authorised budget',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      // Price at the supplier's current commitment: what executing now would actually cost.
      const r = recomputedTotals(ctx, 'current');
      const total = Math.max(r.total, ctx.proposal.totalCents);
      const available = ctx.mission.budgetCents - ctx.committedCents;
      return total <= available
        ? { violations: [], detail: `${money(total)} within ${money(available)} available` }
        : {
            violations: [
              v('BUDGET_CAP', `Total ${money(total)} exceeds available authority ${money(available)} by ${money(total - available)}`, null, {
                totalCents: total,
                shippingCents: r.shippingTotal,
                budgetCents: ctx.mission.budgetCents,
                committedCents: ctx.committedCents,
                availableCents: available,
              }),
            ],
            detail: 'Over budget',
          };
    },
  },
  {
    id: 'QUANTITY_BOUNDS',
    title: 'Quantities stay within the derived need (plus one pack of rounding)',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      for (const r of ctx.requirements) {
        const lines = ctx.proposal.lines.filter((l) => l.requirementId === r.id);
        if (lines.length === 0) continue;
        const maxPack = Math.max(...lines.map((l) => ctx.candidates.get(l.candidateId)?.pack.unitsPerPack ?? 0));
        const planned = lines.reduce((s, l) => s + l.unitsCovered, 0) + (ctx.purchasedUnits[r.id] ?? 0);
        const limit = r.quantity + Math.ceil(maxPack);
        if (planned > limit) {
          out.push(
            v('QUANTITY_BOUNDS', `${r.label}: ${planned} ${r.unit} exceeds authorised need of ${r.quantity} (limit ${limit} with pack rounding)`, lines[0]!.id, {
              requirementId: r.id,
              plannedUnits: planned,
              neededUnits: r.quantity,
              limit,
              alreadyPurchased: ctx.purchasedUnits[r.id] ?? 0,
            }),
          );
        }
      }
      for (const l of ctx.proposal.lines) {
        if (!Number.isInteger(l.quantityPacks) || l.quantityPacks <= 0) out.push(v('QUANTITY_BOUNDS', 'Pack quantity must be a positive integer', l.id));
      }
      return { violations: out, detail: out.length ? 'Quantity exceeds authority' : 'Quantities within need' };
    },
  },
  {
    id: 'STOCK_AVAILABLE',
    title: 'Quantities are within the supplier’s committed stock',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      for (const l of ctx.proposal.lines) {
        const q = ctx.currentQuotes.get(l.candidateId);
        if (q && l.quantityPacks > q.stockPacks) {
          out.push(v('STOCK_AVAILABLE', `"${l.title}": ${l.quantityPacks} packs requested, supplier commits ${q.stockPacks}`, l.id, { requested: l.quantityPacks, stock: q.stockPacks }));
        }
      }
      return { violations: out, detail: out.length ? 'Insufficient stock' : 'Stock sufficient' };
    },
  },
  {
    id: 'DELIVERY_DEADLINE',
    title: 'Every delivery arrives before the hard deadline (with intake buffer)',
    hard: true,
    stages: ALL,
    run: (ctx) => {
      const out: PolicyViolation[] = [];
      const latest = new Date(ctx.mission.deadline).getTime() - INTAKE_BUFFER_MINUTES * 60_000;
      for (const l of ctx.proposal.lines) {
        const q = ctx.currentQuotes.get(l.candidateId);
        const eta = new Date(q?.eta ?? l.eta).getTime();
        if (eta > latest) {
          out.push(
            v('DELIVERY_DEADLINE', `"${l.title}" now arrives ${localTime(new Date(eta), ctx.mission.timezone)}, after the ${localTime(new Date(latest), ctx.mission.timezone)} intake cutoff`, l.id, {
              eta: new Date(eta).toISOString(),
              deadline: ctx.mission.deadline,
              intakeBufferMinutes: INTAKE_BUFFER_MINUTES,
            }),
          );
        }
      }
      return { violations: out, detail: out.length ? 'Deadline violated' : 'All deliveries before cutoff' };
    },
  },
  {
    id: 'APPROVAL_BINDING',
    title: 'An active human approval is bound to exactly these terms',
    hard: true,
    stages: ['execution', 'capture'],
    run: (ctx) => {
      const a = ctx.approval;
      const p = ctx.proposal;
      if (!a) return { violations: [v('APPROVAL_BINDING', 'No human approval exists for this proposal')], detail: 'Approval missing' };
      const out: PolicyViolation[] = [];
      const currentHash = materialTermsHash({
        missionId: p.missionId,
        missionVersion: p.missionVersion,
        currency: p.currency,
        lines: p.lines.map((l) => ({ requirementId: l.requirementId, candidateId: l.candidateId, quoteId: l.quoteId, quantityPacks: l.quantityPacks, unitPriceCents: l.unitPriceCents })),
        shipping: p.shipping,
        subtotalCents: p.subtotalCents,
        shippingCents: p.shippingCents,
        totalCents: p.totalCents,
      });
      if (a.status !== 'ACTIVE') out.push(v('APPROVAL_BINDING', `Approval is ${a.status}${a.invalidatedReason ? `: ${a.invalidatedReason}` : ''}`));
      if (a.proposalId !== p.id) out.push(v('APPROVAL_BINDING', 'Approval belongs to a different proposal', null, { approvalProposal: a.proposalId }));
      if (a.contentHash !== currentHash || currentHash !== p.contentHash) {
        out.push(v('APPROVAL_BINDING', 'Proposal terms changed after approval; the approval cannot be reused', null, { approvedHash: a.contentHash, currentHash }));
      }
      if (a.missionVersion !== ctx.mission.version) {
        out.push(v('APPROVAL_BINDING', `Mission terms changed after approval (v${a.missionVersion} → v${ctx.mission.version})`));
      }
      if (a.amountCents !== p.totalCents || a.currency !== p.currency) {
        out.push(v('APPROVAL_BINDING', `Approved amount ${money(a.amountCents)} ≠ proposal total ${money(p.totalCents)}`));
      }
      return { violations: out, detail: out.length ? 'Approval does not bind these terms' : `Approved by ${a.approverName}` };
    },
  },
  {
    id: 'NO_DUPLICATE_EXECUTION',
    title: 'No other payment exists or is in flight for this proposal',
    hard: true,
    stages: ['execution', 'capture'],
    run: (ctx) => {
      const dupes = ctx.paymentOps.filter(
        (op) => op.proposalId === ctx.proposal.id && op.id !== ctx.currentPaymentOpId && BLOCKING_PAYMENT_STATUSES.includes(op.status),
      );
      return dupes.length === 0
        ? { violations: [], detail: 'No competing payment operation' }
        : {
            violations: [
              v('NO_DUPLICATE_EXECUTION', `A payment operation is already ${dupes[0]!.status} for this proposal`, null, {
                operationIds: dupes.map((d) => d.id),
                statuses: dupes.map((d) => d.status),
              }),
            ],
            detail: 'Duplicate purchase attempt',
          };
    },
  },
  {
    id: 'NO_UNRESOLVED_PAYMENTS',
    title: 'No payment in this mission has an unresolved outcome',
    hard: true,
    stages: ['execution'],
    run: (ctx) => {
      const unresolved = ctx.paymentOps.filter((op) => op.id !== ctx.currentPaymentOpId && UNRESOLVED_PAYMENT_STATUSES.includes(op.status));
      return unresolved.length === 0
        ? { violations: [], detail: 'All prior payment outcomes resolved' }
        : {
            violations: [
              v('NO_UNRESOLVED_PAYMENTS', `Payment ${unresolved[0]!.id.slice(0, 8)} is ${unresolved[0]!.status}; reconcile it with PayPal before any new purchase`, null, {
                operationIds: unresolved.map((u) => u.id),
              }),
            ],
            detail: 'Unresolved payment outcome',
          };
    },
  },
];

function warnings(ctx: PolicyContext): PolicyViolation[] {
  const out: PolicyViolation[] = [];
  const deadline = new Date(ctx.mission.deadline).getTime();
  for (const l of ctx.proposal.lines) {
    const q = ctx.currentQuotes.get(l.candidateId);
    const eta = new Date(q?.eta ?? l.eta).getTime();
    const slackMin = (deadline - eta) / 60_000;
    if (slackMin >= INTAKE_BUFFER_MINUTES && slackMin < AT_RISK_MINUTES + INTAKE_BUFFER_MINUTES) {
      out.push(v('DELIVERY_AT_RISK', `"${l.title}" arrives with only ${Math.round(slackMin)} min before the deadline`, l.id));
    }
    if (l.provenance !== 'channel3') {
      out.push(v('NON_LIVE_DATA', `"${l.title}" comes from ${l.provenance} data, not live Channel3 results`, l.id));
    }
  }
  for (const r of ctx.requirements.filter((x) => x.priority === 'critical')) {
    const merchants = new Set(ctx.proposal.lines.filter((l) => l.requirementId === r.id).map((l) => l.merchantDomain));
    if (merchants.size === 1) out.push(v('SINGLE_SOURCE', `${r.label} depends on a single supplier`));
  }
  return out;
}

export function evaluatePolicy(ctx: PolicyContext): PolicyEvaluation {
  const checks: PolicyCheckResult[] = [];
  const violations: PolicyViolation[] = [];
  for (const def of CHECKS) {
    if (!def.stages.includes(ctx.stage)) continue;
    const res = def.run(ctx);
    checks.push({ checkId: def.id, title: def.title, hard: def.hard, passed: res.violations.length === 0, detail: res.detail });
    if (def.hard) violations.push(...res.violations);
  }
  return {
    outcome: violations.length === 0 ? 'ALLOW' : 'DENY',
    checks,
    violations,
    warnings: warnings(ctx),
    engineVersion: POLICY_ENGINE_VERSION,
  };
}

export const POLICY_CHECK_CATALOG = CHECKS.map(({ id, title, hard, stages }) => ({ id, title, hard, stages }));
