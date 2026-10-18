import { createHash } from 'node:crypto';
import type { RequirementCategory } from '../../shared/types.js';

// SIMULATED supplier fulfilment commitments. No catalog API (Channel3 included) exposes stock levels
// or same-day delivery commitments to an emergency shelter, so RELIEFOS models them with a seeded,
// deterministic generator. Every quote is persisted with `simulated = true` semantics and labelled as
// such in the UI. Product suitability (from the catalog) and delivery feasibility (from this model)
// are evaluated separately.

/** Deterministic PRNG in [0,1) from a string seed (mulberry32 over a SHA-256-derived state). */
export function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, min: number, max: number) => Math.round(min + r() * (max - min));

export interface QuoteInput {
  missionId: string;
  sourceProductId: string;
  merchantDomain: string;
  category: RequirementCategory;
  priceCents: number;
  unitsPerPack: number;
  requirementUnits: number;
  windowStart: Date;
}

export interface SimulatedQuote {
  stockPacks: number;
  unitPriceCents: number;
  shippingBaseCents: number;
  shippingPerPackCents: number;
  dispatchAt: Date;
  eta: Date;
  carrier: string;
  reason: string;
}

const HEAVY: RequirementCategory[] = ['water'];

export function simulateQuote(input: QuoteInput): SimulatedQuote {
  const item = seededRandom(`${input.missionId}|${input.sourceProductId}`);
  const merchant = seededRandom(`${input.missionId}|merchant|${input.merchantDomain}`);

  const packsNeeded = Math.max(1, Math.ceil(input.requirementUnits / input.unitsPerPack));
  // Stock between 40% and 260% of what this requirement needs: some suppliers can cover the whole
  // need, some only part of it, which is what forces split orders and recovery.
  const stockPacks = Math.max(1, Math.round(packsNeeded * (0.4 + item() * 2.2)));

  // Courier dispatch fee per merchant, plus a per-pack handling charge weighted by item weight.
  const shippingBaseCents = between(merchant, 1500, 4500);
  const shippingPerPackCents = HEAVY.includes(input.category) ? between(item, 40, 120) : between(item, 10, 60);

  const dispatchOffsetMin = between(item, 20, 90);
  const transitMin = between(merchant, 70, 280) + between(item, 0, 40);
  const dispatchAt = new Date(input.windowStart.getTime() + dispatchOffsetMin * 60_000);
  const eta = new Date(dispatchAt.getTime() + transitMin * 60_000);

  return {
    stockPacks,
    unitPriceCents: input.priceCents,
    shippingBaseCents,
    shippingPerPackCents,
    dispatchAt,
    eta,
    carrier: `Courier lane · ${input.merchantDomain}`,
    reason: 'initial simulated supplier commitment',
  };
}
