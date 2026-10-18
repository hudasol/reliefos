import { createHash } from 'node:crypto';

/** JSON with sorted object keys, so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface MaterialTerms {
  missionId: string;
  missionVersion: number;
  currency: string;
  lines: {
    requirementId: string;
    candidateId: string;
    quoteId: string;
    quantityPacks: number;
    unitPriceCents: number;
  }[];
  shipping: { merchantDomain: string; cents: number }[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

/**
 * Hash of every term a coordinator approves. Any material change — product, supplier quote,
 * quantity, price, shipping, total, or the mission version — yields a different hash, which is what
 * makes an approval non-transferable to a changed proposal.
 */
export function materialTermsHash(t: MaterialTerms): string {
  return sha256(
    canonicalJson({
      ...t,
      lines: [...t.lines].sort((a, b) =>
        (a.candidateId + a.quoteId).localeCompare(b.candidateId + b.quoteId),
      ),
    }),
  );
}
