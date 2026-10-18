import { localTime } from '../../shared/time.js';
import type {
  FulfillmentQuote,
  Gap,
  Priority,
  ProductCandidate,
  Requirement,
  ShippingCharge,
} from '../../shared/types.js';

// Deterministic procurement optimizer. It enforces hard constraints before it optimises anything:
// a candidate that fails a hard constraint is excluded with a reason, never traded off against price.
// Budget pressure is resolved by reducing the lowest-priority coverage first and reporting the gap.

export const INTAKE_BUFFER_MINUTES = 30;

export interface PlanOption {
  candidate: ProductCandidate;
  quote: FulfillmentQuote | null;
}

export interface PlanInput {
  requirements: Requirement[];
  options: PlanOption[];
  budgetCents: number;
  /** Spend already committed by earlier executed proposals of this mission. */
  committedCents: number;
  deadline: Date;
  timeZone?: string;
  /** Units already purchased per requirement by earlier executed proposals. */
  purchasedUnits: Record<string, number>;
  /** Buyer-agent preference: candidate ids to try first, per requirement. Still fully validated. */
  preferred?: Record<string, string[]>;
  /** Candidates excluded by a recovery decision (e.g. quarantined after a policy rejection). */
  excludedCandidateIds?: Set<string>;
}

export interface PlannedLine {
  requirementId: string;
  candidateId: string;
  quoteId: string;
  title: string;
  merchantDomain: string;
  provenance: ProductCandidate['provenance'];
  quantityPacks: number;
  unitsPerPack: number;
  unitsCovered: number;
  unitPriceCents: number;
  lineTotalCents: number;
  shippingPerPackCents: number;
  shippingBaseCents: number;
  eta: string;
}

export interface Exclusion {
  candidateId: string;
  requirementId: string;
  title: string;
  reasons: string[];
}

export interface PlanResult {
  lines: PlannedLine[];
  shipping: ShippingCharge[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  gaps: Gap[];
  tradeoffs: string[];
  exclusions: Exclusion[];
  feasible: boolean;
}

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, standard: 2 };

export function eligibilityReasons(opt: PlanOption, deadline: Date, timeZone?: string): string[] {
  const { candidate: c, quote: q } = opt;
  const reasons: string[] = [];
  if (c.quarantined)
    reasons.push('Quarantined: listing content attempted to instruct the purchasing agent');
  if (!c.specCheck.passed) reasons.push(...c.specCheck.reasons.map((r) => `Spec: ${r}`));
  if (!c.pack.unitsPerPack || c.pack.unitsPerPack <= 0)
    reasons.push('Pack size could not be established from the listing');
  if (c.priceCents === null) reasons.push('No usable in-stock USD offer price');
  if (c.currency !== 'USD')
    reasons.push(`Currency ${c.currency} does not match mission currency USD`);
  if (!c.merchantDomain) reasons.push('No merchant identified for the offer');
  if (!q) {
    reasons.push('No supplier fulfilment commitment');
  } else {
    if (q.stockPacks <= 0) reasons.push('Supplier reports no stock');
    const latest = deadline.getTime() - INTAKE_BUFFER_MINUTES * 60_000;
    if (new Date(q.eta).getTime() > latest) {
      reasons.push(
        `Delivery ETA ${localTime(q.eta, timeZone)} misses the ${localTime(new Date(latest), timeZone)} intake cutoff (${INTAKE_BUFFER_MINUTES} min before the deadline)`,
      );
    }
  }
  return reasons;
}

function costPerUnit(opt: PlanOption): number {
  const q = opt.quote!;
  return (q.unitPriceCents + q.shippingPerPackCents) / opt.candidate.pack.unitsPerPack!;
}

export function computeShipping(lines: PlannedLine[]): ShippingCharge[] {
  const byMerchant = new Map<string, { base: number; perPack: number }>();
  for (const l of lines) {
    if (l.quantityPacks <= 0) continue;
    const cur = byMerchant.get(l.merchantDomain) ?? { base: 0, perPack: 0 };
    cur.base = Math.max(cur.base, l.shippingBaseCents);
    cur.perPack += l.shippingPerPackCents * l.quantityPacks;
    byMerchant.set(l.merchantDomain, cur);
  }
  return [...byMerchant.entries()]
    .map(([merchantDomain, v]) => ({ merchantDomain, cents: v.base + v.perPack }))
    .sort((a, b) => a.merchantDomain.localeCompare(b.merchantDomain));
}

function totals(lines: PlannedLine[]) {
  const live = lines.filter((l) => l.quantityPacks > 0);
  for (const l of live) {
    l.lineTotalCents = l.quantityPacks * l.unitPriceCents;
    l.unitsCovered = Math.floor(l.quantityPacks * l.unitsPerPack);
  }
  const shipping = computeShipping(live);
  const subtotalCents = live.reduce((s, l) => s + l.lineTotalCents, 0);
  const shippingCents = shipping.reduce((s, c) => s + c.cents, 0);
  return { shipping, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents };
}

export function optimizePlan(input: PlanInput): PlanResult {
  const exclusions: Exclusion[] = [];
  const tradeoffs: string[] = [];
  const lines: PlannedLine[] = [];
  const reqById = new Map(input.requirements.map((r) => [r.id, r]));
  const available = input.budgetCents - input.committedCents;

  const eligibleByReq = new Map<string, PlanOption[]>();
  for (const opt of input.options) {
    const reasons = eligibilityReasons(opt, input.deadline, input.timeZone);
    if (input.excludedCandidateIds?.has(opt.candidate.id))
      reasons.push('Excluded by recovery decision');
    if (reasons.length > 0) {
      exclusions.push({
        candidateId: opt.candidate.id,
        requirementId: opt.candidate.requirementId,
        title: opt.candidate.title,
        reasons,
      });
      continue;
    }
    const list = eligibleByReq.get(opt.candidate.requirementId) ?? [];
    list.push(opt);
    eligibleByReq.set(opt.candidate.requirementId, list);
  }

  const ordered = [...input.requirements].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
  for (const req of ordered) {
    let remaining = req.quantity - (input.purchasedUnits[req.id] ?? 0);
    if (remaining <= 0) continue;
    const preferred = input.preferred?.[req.id] ?? [];
    const pool = [...(eligibleByReq.get(req.id) ?? [])];
    // Effective cost of covering what is still needed with an option: pack rounding waste counts,
    // so a cheaper-per-unit bulk pack that overshoots the need does not win by default. The buyer
    // agent's ranking nudges the score by 5% per rank position; it cannot override cost by much.
    const score = (opt: PlanOption, need: number) => {
      const per = opt.candidate.pack.unitsPerPack!;
      const packs = Math.min(opt.quote!.stockPacks, Math.ceil(need / per));
      const useful = Math.min(need, Math.floor(packs * per));
      const rank = preferred.indexOf(opt.candidate.id);
      const nudge = 1 + 0.05 * (rank === -1 ? preferred.length : rank);
      return useful > 0
        ? ((packs * (opt.quote!.unitPriceCents + opt.quote!.shippingPerPackCents)) / useful) * nudge
        : Infinity;
    };
    let suppliers = 0;
    while (remaining > 0 && suppliers < 3 && pool.length > 0) {
      pool.sort(
        (a, b) =>
          score(a, remaining) - score(b, remaining) ||
          costPerUnit(a) - costPerUnit(b) ||
          a.candidate.id.localeCompare(b.candidate.id),
      );
      const opt = pool.shift()!;
      const per = opt.candidate.pack.unitsPerPack!;
      const q = opt.quote!;
      const packs = Math.min(q.stockPacks, Math.ceil(remaining / per));
      if (packs <= 0) continue;
      suppliers += 1;
      if (packs < Math.ceil(remaining / per)) {
        tradeoffs.push(
          `${req.label}: ${opt.candidate.merchantDomain} can supply only ${packs} packs; splitting across suppliers.`,
        );
      }
      lines.push({
        requirementId: req.id,
        candidateId: opt.candidate.id,
        quoteId: q.id,
        title: opt.candidate.title,
        merchantDomain: opt.candidate.merchantDomain!,
        provenance: opt.candidate.provenance,
        quantityPacks: packs,
        unitsPerPack: per,
        unitsCovered: Math.floor(packs * per),
        unitPriceCents: q.unitPriceCents,
        lineTotalCents: packs * q.unitPriceCents,
        shippingPerPackCents: q.shippingPerPackCents,
        shippingBaseCents: q.shippingBaseCents,
        eta: q.eta,
      });
      remaining -= Math.floor(packs * per);
    }
  }

  // Budget enforcement: shed coverage from the lowest priority, most expensive lines first.
  let t = totals(lines);
  const reducedForBudget = new Set<string>();
  if (t.totalCents > available) {
    const reducible = [...lines].sort((a, b) => {
      const pa = PRIORITY_ORDER[reqById.get(a.requirementId)!.priority];
      const pb = PRIORITY_ORDER[reqById.get(b.requirementId)!.priority];
      if (pa !== pb) return pb - pa; // standard first, critical last
      return b.unitPriceCents / b.unitsPerPack - a.unitPriceCents / a.unitsPerPack;
    });
    for (const line of reducible) {
      if (t.totalCents <= available) break;
      const before = line.quantityPacks;
      while (line.quantityPacks > 0 && t.totalCents > available) {
        line.quantityPacks -= 1;
        t = totals(lines);
      }
      const req = reqById.get(line.requirementId)!;
      if (line.quantityPacks < before) {
        reducedForBudget.add(req.id);
        tradeoffs.push(
          `${req.label} (${req.priority}): reduced ${line.merchantDomain} from ${before} to ${line.quantityPacks} packs to stay within the authorised budget.`,
        );
      }
    }
  }

  const finalLines = lines.filter((l) => l.quantityPacks > 0);
  t = totals(finalLines);

  const gaps: Gap[] = [];
  for (const req of input.requirements) {
    const purchased = input.purchasedUnits[req.id] ?? 0;
    const planned = finalLines
      .filter((l) => l.requirementId === req.id)
      .reduce((s, l) => s + l.unitsCovered, 0);
    const shortfall = req.quantity - purchased - planned;
    if (shortfall > 0) {
      const hadOptions = (eligibleByReq.get(req.id) ?? []).length > 0;
      gaps.push({
        requirementId: req.id,
        label: req.label,
        neededUnits: req.quantity,
        plannedUnits: purchased + planned,
        shortfallUnits: shortfall,
        reason: !hadOptions
          ? 'No eligible product can be delivered before the deadline'
          : reducedForBudget.has(req.id)
            ? 'Coverage reduced to stay within the authorised budget'
            : 'Eligible suppliers lack stock for the full quantity before the deadline',
      });
    }
  }

  return {
    lines: finalLines,
    shipping: t.shipping,
    subtotalCents: t.subtotalCents,
    shippingCents: t.shippingCents,
    totalCents: t.totalCents,
    gaps,
    tradeoffs,
    exclusions,
    feasible: finalLines.length > 0 && t.totalCents <= available,
  };
}
