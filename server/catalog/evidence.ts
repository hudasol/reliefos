import type {
  PackInfo,
  RequirementCategory,
  RequirementSpec,
  SpecCheck,
} from '../../shared/types.js';

// Deterministic evidence extraction from product text. Every extracted value carries the exact text
// it came from. When a value cannot be established it is `null` — never assumed to satisfy a need.

const LITERS_PER_FL_OZ = 0.0295735;
const LITERS_PER_GALLON = 3.78541;

function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m;
  }
  return null;
}

const COUNT_PATTERNS = [
  /\b(?:pack|case|set|box|bundle|lot|bulk)\s+of\s+(\d{1,4})\b/i,
  /\b(\d{1,4})\s*[- ]?(?:pack|pk|count|ct|piece|pcs|pc|set|bottles|jugs|kits|blankets|units)\b/i,
  // "24 x 500 mL" style counts; a bare "62x80" is a dimension, not a count.
  /\b(\d{1,3})\s*x\s*\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|ml|l)\b/i,
];

function parseCount(text: string): { count: number; evidence: string } | null {
  const m = firstMatch(text, COUNT_PATTERNS);
  if (!m?.[1]) return null;
  const count = Number(m[1]);
  return count > 0 ? { count, evidence: m[0] } : null;
}

function parseVolumeLiters(text: string): { liters: number; evidence: string } | null {
  const patterns: [RegExp, (n: number) => number][] = [
    [/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|fluid\s+ounces?)\b/i, (n) => n * LITERS_PER_FL_OZ],
    [/(\d+(?:\.\d+)?)\s*(?:ml|milliliters?|millilitres?)\b/i, (n) => n / 1000],
    [/(\d+(?:\.\d+)?)\s*(?:gal|gallons?)\b/i, (n) => n * LITERS_PER_GALLON],
    [/(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?|ltr)\b/i, (n) => n],
    [/(\d+(?:\.\d+)?)\s*oz\b/i, (n) => n * LITERS_PER_FL_OZ],
  ];
  for (const [re, toLiters] of patterns) {
    const m = re.exec(text);
    if (m?.[1]) {
      const liters = toLiters(Number(m[1]));
      if (liters > 0 && liters <= 40) return { liters, evidence: m[0] };
    }
  }
  return null;
}

/** How many requirement units one purchasable listing covers, with the text that proves it. */
export function parsePack(
  category: RequirementCategory,
  title: string,
  description: string | null,
): PackInfo {
  const sources: ['parsed-title' | 'parsed-description', string][] = [['parsed-title', title]];
  if (description) sources.push(['parsed-description', description]);

  for (const [basis, text] of sources) {
    if (category === 'water') {
      const vol = parseVolumeLiters(text);
      if (!vol) continue;
      const count = parseCount(text);
      const units = Math.round(vol.liters * (count?.count ?? 1) * 100) / 100;
      return {
        unitsPerPack: units,
        basis,
        evidence: count
          ? `${count.evidence}; ${vol.evidence}`
          : `${vol.evidence} (single unit; no pack count stated)`,
      };
    }
    if (category === 'baby') {
      const m =
        /\b(\d{2,4})\s*(?:count|ct|diapers|pcs)\b/i.exec(text) ??
        /\b(?:pack|box|case)\s+of\s+(\d{2,4})\b/i.exec(text);
      if (m?.[1]) return { unitsPerPack: Number(m[1]), basis, evidence: m[0] };
      continue;
    }
    const count = parseCount(text);
    if (count) return { unitsPerPack: count.count, basis, evidence: count.evidence };
  }

  // Single-item listings: a blanket, kit or power bank whose title names exactly one item.
  if (category !== 'water' && category !== 'baby') {
    const singular: Record<string, RegExp> = {
      blankets: /\b(?:a|one|1)?\s*(?:fleece|throw|wool|cotton|emergency)?\s*blanket\b(?!s)/i,
      hygiene: /\bhygiene kit\b(?!s)/i,
      power: /\b(?:power bank|portable charger)\b(?!s)/i,
    };
    const re = singular[category];
    const m = re ? re.exec(title) : null;
    if (m)
      return { unitsPerPack: 1, basis: 'parsed-title', evidence: `${m[0].trim()} (single item)` };
  }
  return { unitsPerPack: null, basis: 'unknown', evidence: null };
}

export function parseAttributes(
  title: string,
  description: string | null,
): Record<string, number | string> {
  const attrs: Record<string, number | string> = {};
  const text = `${title} ${description ?? ''}`;
  const mah = /(\d{1,3}(?:,\d{3})+|\d{4,6})\s*mAh\b/i.exec(text);
  if (mah?.[1]) attrs.capacity_mAh = Number(mah[1].replace(/,/g, ''));
  return attrs;
}

/** Hard specification check. Unknown numeric attributes fail: absence of evidence is not compliance. */
export function checkSpec(
  spec: RequirementSpec,
  product: { title: string; description: string | null },
  attributes: Record<string, number | string>,
): SpecCheck {
  const reasons: string[] = [];
  // Match against the title primarily; descriptions are long and often mention unrelated items.
  const title = product.title;

  const matchedRequired = spec.mustMatchAny.some((src) => new RegExp(src, 'i').test(title));
  if (!matchedRequired) reasons.push('Title does not identify the required item type');

  for (const src of spec.mustNotMatch) {
    const m = new RegExp(src, 'i').exec(title);
    if (m) reasons.push(`Prohibited characteristic in title: "${m[0]}"`);
  }

  for (const n of spec.numeric) {
    const raw = attributes[n.attribute];
    const value = typeof raw === 'number' ? raw : null;
    if (value === null) {
      reasons.push(`${n.attribute} not stated in listing (required${n.min ? ` ≥ ${n.min}` : ''})`);
      continue;
    }
    if (n.min !== undefined && value < n.min)
      reasons.push(`${n.attribute} ${value} below minimum ${n.min}`);
    if (n.max !== undefined && value > n.max)
      reasons.push(`${n.attribute} ${value} above maximum ${n.max}`);
  }
  return { passed: reasons.length === 0, reasons };
}
