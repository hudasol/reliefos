import { randomUUID } from 'node:crypto';
import type {
  FulfillmentQuote,
  ProductCandidate,
  Proposal,
  Requirement,
} from '../../shared/types.js';
import { deriveRequirements } from '../../server/domain/requirements.js';
import { checkSpec, parseAttributes, parsePack } from '../../server/catalog/evidence.js';
import { isBlocking, scanContent } from '../../server/catalog/contentSecurity.js';
import { optimizePlan, type PlanResult } from '../../server/planning/optimizer.js';
import { materialTermsHash } from '../../server/planning/hash.js';
import type { PolicyContext } from '../../server/policy/engine.js';

export const MISSION_ID = '00000000-0000-4000-8000-000000000001';
export const WINDOW_START = new Date('2026-10-20T15:00:00.000Z'); // 11:00 EDT
export const DEADLINE = new Date('2026-10-20T21:00:00.000Z'); // 17:00 EDT

export function makeRequirements(): Requirement[] {
  return deriveRequirements({ population: 120, infants: 8, householdSize: 4, coverageDays: 3 }).map(
    (d, i) => ({
      ...d,
      id: `req-${d.category}`,
      missionId: MISSION_ID,
      searchQuery: d.searchQuery,
      basis: d.basis,
      position: i,
    }),
  );
}

export function makeCandidate(
  req: Requirement,
  overrides: Partial<ProductCandidate> & { title: string; priceCents: number },
): ProductCandidate {
  const description = overrides.description ?? null;
  const pack = overrides.pack ?? parsePack(req.category, overrides.title, description);
  const attributes = parseAttributes(overrides.title, description);
  const flags = scanContent({
    title: overrides.title,
    description,
    merchant: overrides.merchantDomain ?? null,
  });
  return {
    id: overrides.id ?? `cand-${randomUUID().slice(0, 8)}`,
    missionId: MISSION_ID,
    requirementId: req.id,
    provenance: 'fixture',
    sourceProductId: `src-${randomUUID().slice(0, 8)}`,
    brand: null,
    imageUrl: null,
    buyUrl: null,
    merchantDomain: 'supplier-a.example',
    currency: 'USD',
    listedAvailability: 'InStock',
    attributes,
    specCheck: checkSpec(req.spec, { title: overrides.title, description }, attributes),
    contentFlags: flags,
    quarantined: isBlocking(flags),
    suitability: null,
    retrievedAt: WINDOW_START.toISOString(),
    ...overrides,
    description,
    pack,
  };
}

export function makeQuote(
  c: ProductCandidate,
  overrides: Partial<FulfillmentQuote> = {},
): FulfillmentQuote {
  return {
    id: `quote-${c.id}`,
    candidateId: c.id,
    missionId: MISSION_ID,
    simulated: true,
    stockPacks: 1000,
    unitPriceCents: c.priceCents ?? 0,
    shippingBaseCents: 2000,
    shippingPerPackCents: 50,
    dispatchAt: new Date(WINDOW_START.getTime() + 30 * 60_000).toISOString(),
    eta: new Date(WINDOW_START.getTime() + 3 * 3600_000).toISOString(),
    carrier: 'test courier',
    reason: 'initial simulated supplier commitment',
    quotedAt: WINDOW_START.toISOString(),
    current: true,
    ...overrides,
  };
}

/** A standard catalog where every requirement has one compliant, affordable option. */
export function makeScenario() {
  const requirements = makeRequirements();
  const r = Object.fromEntries(requirements.map((x) => [x.category, x])) as Record<
    string,
    Requirement
  >;
  const candidates = [
    makeCandidate(r.water!, {
      id: 'c-water',
      title: 'Purified Drinking Water, 16.9 fl oz Bottles, Pack of 24',
      priceCents: 549,
      merchantDomain: 'harbor.example',
    }),
    makeCandidate(r.blankets!, {
      id: 'c-blanket',
      title: 'Polar Fleece Throw Blankets, Pack of 12',
      priceCents: 9400,
      merchantDomain: 'harbor.example',
    }),
    makeCandidate(r.hygiene!, {
      id: 'c-hygiene',
      title: 'Individually Packed Hygiene Kits, 10 Pack',
      priceCents: 13900,
      merchantDomain: 'eastside.example',
    }),
    makeCandidate(r.power!, {
      id: 'c-power',
      title: 'Portable Power Bank 10000mAh USB-C, 2 Pack',
      priceCents: 4198,
      merchantDomain: 'quick.example',
    }),
    makeCandidate(r.baby!, {
      id: 'c-baby',
      title: 'Disposable Baby Diapers Size 3, 136 Count',
      priceCents: 3999,
      merchantDomain: 'eastside.example',
    }),
  ];
  const quotes = candidates.map((c) => makeQuote(c));
  return { requirements, r, candidates, quotes };
}

export function planFor(s: ReturnType<typeof makeScenario>, budgetCents = 400_000): PlanResult {
  return optimizePlan({
    requirements: s.requirements,
    options: s.candidates.map((c) => ({
      candidate: c,
      quote: s.quotes.find((q) => q.candidateId === c.id) ?? null,
    })),
    budgetCents,
    committedCents: 0,
    deadline: DEADLINE,
    purchasedUnits: {},
  });
}

export function proposalFromPlan(plan: PlanResult, version = 1): Proposal {
  const lines = plan.lines.map((l, i) => ({
    id: `line-${i}`,
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
  const terms = {
    missionId: MISSION_ID,
    missionVersion: 1,
    currency: 'USD',
    lines: lines.map((l) => ({
      requirementId: l.requirementId,
      candidateId: l.candidateId,
      quoteId: l.quoteId,
      quantityPacks: l.quantityPacks,
      unitPriceCents: l.unitPriceCents,
    })),
    shipping: plan.shipping,
    subtotalCents: plan.subtotalCents,
    shippingCents: plan.shippingCents,
    totalCents: plan.totalCents,
  };
  return {
    id: `proposal-${version}`,
    missionId: MISSION_ID,
    version,
    status: 'DRAFT',
    parentProposalId: null,
    createdBy: 'test',
    plannerMode: 'deterministic',
    rationale: '',
    tradeoffs: plan.tradeoffs,
    currency: 'USD',
    subtotalCents: plan.subtotalCents,
    shippingCents: plan.shippingCents,
    shipping: plan.shipping,
    totalCents: plan.totalCents,
    contentHash: materialTermsHash(terms),
    missionVersion: 1,
    lines,
    gaps: plan.gaps,
    createdAt: WINDOW_START.toISOString(),
    updatedAt: WINDOW_START.toISOString(),
    latestDecision: null,
  };
}

export function policyContext(
  s: ReturnType<typeof makeScenario>,
  proposal: Proposal,
  overrides: Partial<PolicyContext> = {},
): PolicyContext {
  return {
    stage: 'validation',
    now: WINDOW_START,
    mission: {
      id: MISSION_ID,
      status: 'PLANNING',
      version: 1,
      budgetCents: 400_000,
      currency: 'USD',
      deadline: DEADLINE.toISOString(),
    },
    requirements: s.requirements,
    proposal,
    candidates: new Map(s.candidates.map((c) => [c.id, c])),
    currentQuotes: new Map(s.quotes.map((q) => [q.candidateId, q])),
    quotesById: new Map(s.quotes.map((q) => [q.id, q])),
    committedCents: 0,
    purchasedUnits: {},
    approval: null,
    paymentOps: [],
    ...overrides,
  };
}
