import type { RequirementCategory } from '../../shared/types.js';
import type { AgentResult, Explanation, ExplanationInput, Interpretation, MissionAgent, Selection, SelectionInput } from './types.js';

// Transparent deterministic stand-in for the Claude agent. It exercises the same workflow and
// produces the same validated shapes, and every result is labelled mode = 'deterministic' so it is
// never mistaken for live model output.

const CATEGORY_WORDS: [RequirementCategory, RegExp][] = [
  ['water', /\bwater\b/i],
  ['blankets', /\bblankets?\b/i],
  ['hygiene', /\bhygiene\b|toiletr/i],
  ['power', /\bcharg|power ?banks?|batter/i],
  ['baby', /\bbaby|infant|diaper|nappy/i],
];

function find(re: RegExp, text: string): { value: string; quote: string } | null {
  const m = re.exec(text);
  return m?.[1] ? { value: m[1], quote: m[0].trim() } : null;
}

export function interpretDeterministically(narrative: string): Interpretation {
  const evidence: Interpretation['evidence'] = [];
  const ambiguities: string[] = [];
  const take = (field: string, re: RegExp) => {
    const hit = find(re, narrative);
    if (hit) evidence.push({ field, quote: hit.quote });
    return hit?.value ?? null;
  };

  const population = take('population', /\b(\d{1,5})\s+(?:people|persons|residents|evacuees|survivors)\b/i);
  const infants = take('infants', /\b(\d{1,4})\s+(?:infants|babies|toddlers)\b/i);
  const budget = take('budgetUsd', /\$\s?([\d,]+(?:\.\d{2})?)\s*(?:budget|limit|authori[sz]ed)?/i);
  const horizon = take('planningHorizonHours', /\b(\d{1,2})[- ]hour\b/i);
  let deadlineLocalTime: string | null = null;
  const dm = /\b(?:before|by|no later than)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(narrative);
  if (dm) {
    let h = Number(dm[1]) % 12;
    if (dm[3]!.toLowerCase() === 'pm') h += 12;
    deadlineLocalTime = `${String(h).padStart(2, '0')}:${dm[2] ?? '00'}`;
    evidence.push({ field: 'deadlineLocalTime', quote: dm[0] });
  }
  const destHit = find(/\b(?:to|at)\s+(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3}\s+(?:shelter|center|centre|school|hall))\b/, narrative)
    ?? find(/\b(?:the\s+)?((?:east|west|north|south)\s+shelter)\b/i, narrative);
  if (destHit) evidence.push({ field: 'destination', quote: destHit.quote });
  const orgHit = find(/^([A-Z][\w&.' -]{2,60}?)\s+(?:needs|requests|is requesting|must)/m, narrative);
  if (orgHit) evidence.push({ field: 'organization', quote: orgHit.quote });

  const categories = CATEGORY_WORDS.filter(([, re]) => re.test(narrative)).map(([c]) => c);

  if (!population) ambiguities.push('Number of people to support is not stated.');
  if (!budget) ambiguities.push('Authorised budget is not stated.');
  if (!deadlineLocalTime) ambiguities.push('Delivery deadline is not stated.');
  if (!destHit) ambiguities.push('Delivery destination is not stated.');
  if (categories.includes('baby') && !infants) ambiguities.push('Baby supplies requested but the number of infants is not stated.');
  ambiguities.push('Household size and supply coverage days are not stated; defaults (4 people, 3 days) will apply unless changed.');

  return {
    organization: orgHit?.value ?? null,
    title: null,
    population: population ? Number(population.replace(/,/g, '')) : null,
    infants: infants ? Number(infants) : null,
    householdSize: null,
    coverageDays: null,
    budgetUsd: budget ? Number(budget.replace(/,/g, '')) : null,
    deadlineLocalTime,
    planningHorizonHours: horizon ? Number(horizon) : null,
    destination: destHit ? destHit.value.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    categories,
    evidence,
    ambiguities,
  };
}

export function selectDeterministically(input: SelectionInput): Selection {
  return {
    selections: input.requirements.map((r) => {
      const opts = [...(input.options[r.id] ?? [])].sort((a, b) => a.costPerUnitCents - b.costPerUnitCents);
      return {
        requirementId: r.id,
        candidateIds: opts.map((o) => o.candidateId),
        rationale: opts.length
          ? `Ranked by lowest delivered cost per ${r.unit}; all options already passed specification, evidence and deadline checks.`
          : 'No eligible options.',
      };
    }),
    suspiciousListings: [],
  };
}

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Collapse repeated warnings of the same kind into one readable point. */
function summariseWarnings(warnings: ExplanationInput['warnings']): string[] {
  const byCheck = new Map<string, string[]>();
  for (const w of warnings) byCheck.set(w.checkId, [...(byCheck.get(w.checkId) ?? []), w.message]);
  const out: string[] = [];
  for (const [check, msgs] of byCheck) {
    if (check === 'NON_LIVE_DATA') out.push(`${msgs.length} line(s) use labelled fixture or simulated data, not live Channel3 results.`);
    else if (msgs.length > 2) out.push(`${msgs[0]} (+${msgs.length - 1} similar)`);
    else out.push(...msgs);
  }
  return out;
}

export function explainDeterministically(input: ExplanationInput): Explanation {
  if (input.kind === 'rejection') {
    return {
      headline: `The policy gate blocked this proposal: ${input.violations.length} hard rule${input.violations.length === 1 ? '' : 's'} failed.`,
      points: input.violations.map((v) => v.message),
      nextStep: 'Generate a recovery plan. RELIEFOS will re-plan against current supplier commitments and re-validate it.',
    };
  }
  if (input.kind === 'recovery') {
    return {
      headline: `Recovery plan totals ${money(input.totalCents)} of ${money(input.budgetCents)} and passed every hard policy check.`,
      points: [...input.changes, ...input.gaps.map((g) => `Remaining gap: ${g.label} short by ${g.shortfallUnits} (${g.reason}).`)],
      nextStep: 'Review the revised lines and approve to proceed to PayPal.',
    };
  }
  return {
    headline: `Proposal totals ${money(input.totalCents)} of ${money(input.budgetCents)} and passed every hard policy check.`,
    points: [...summariseWarnings(input.warnings), ...input.gaps.map((g) => `Gap: ${g.label} short by ${g.shortfallUnits} (${g.reason}).`)],
    nextStep: 'Review and approve to proceed to PayPal.',
  };
}

export class DeterministicAgent implements MissionAgent {
  readonly mode = 'deterministic' as const;
  readonly model = null;

  private wrap<T>(fn: () => T): Promise<AgentResult<T>> {
    const t0 = Date.now();
    const output = fn();
    return Promise.resolve({ output, mode: 'deterministic', model: null, latencyMs: Date.now() - t0, valid: true, error: null });
  }

  interpret(narrative: string) {
    return this.wrap(() => interpretDeterministically(narrative));
  }
  select(input: SelectionInput) {
    return this.wrap(() => selectDeterministically(input));
  }
  explain(input: ExplanationInput) {
    return this.wrap(() => explainDeterministically(input));
  }
}
