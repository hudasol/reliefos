import type { Priority, RequirementCategory, RequirementSpec } from '../../shared/types.js';

// Deterministic requirement derivation. Quantities are computed in code from mission parameters and
// published planning assumptions — never by a language model. Each assumption is surfaced in the UI.

export const PLANNING_ASSUMPTIONS = {
  drinkingWaterLitersPerPersonPerDay: {
    value: 3,
    source: 'Sphere Handbook survival drinking-water need of 2.5–3 L per person per day (upper bound used).',
  },
  blanketsPerPerson: { value: 1, source: 'One blanket per sheltered person (planning assumption).' },
  hygieneKitsPerHousehold: { value: 1, source: 'One hygiene kit per household (planning assumption).' },
  peoplePerPowerBank: { value: 10, source: 'One shared power bank per 10 people (planning assumption).' },
  diapersPerInfantPerDay: { value: 8, source: 'About 8 diapers per infant per day (planning assumption).' },
  minPowerBankCapacityMah: { value: 10_000, source: 'Minimum 10,000 mAh to charge a phone ~2 times.' },
} as const;

export interface MissionParameters {
  population: number;
  infants: number;
  householdSize: number;
  coverageDays: number;
}

export interface DerivedRequirement {
  category: RequirementCategory;
  label: string;
  quantity: number;
  unit: string;
  priority: Priority;
  spec: RequirementSpec;
  searchQuery: string;
  rationale: string;
  basis: Record<string, number | string>;
}

const COMMON_PROHIBITED = ['\\bused\\b', 'refurbished', 'open[- ]box', '\\bsample\\b', '\\btoy\\b', 'costume'];

export function deriveRequirements(p: MissionParameters): DerivedRequirement[] {
  const a = PLANNING_ASSUMPTIONS;
  const out: DerivedRequirement[] = [];

  const liters = p.population * a.drinkingWaterLitersPerPersonPerDay.value * p.coverageDays;
  out.push({
    category: 'water',
    label: 'Drinking water (sealed, potable)',
    quantity: liters,
    unit: 'L',
    priority: 'critical',
    spec: {
      mustMatchAny: ['\\bwater\\b'],
      mustNotMatch: [
        ...COMMON_PROHIBITED,
        'sparkling',
        'seltzer',
        'flavou?r',
        'filter',
        'purifier',
        'purification',
        // Exclude empty/reusable containers that match "water bottle" but contain no water.
        'reusable',
        'insulated',
        'stainless',
        'bpa[- ]free',
        'collapsible',
        '\\bempty\\b',
        'tumbler',
        'flask',
        'enhancer',
        'coconut',
        'tonic',
        'dispenser',
        'cooler',
      ],
      numeric: [],
    },
    searchQuery: 'bottled drinking water case 24 pack',
    rationale: `${p.population} people × ${a.drinkingWaterLitersPerPersonPerDay.value} L/day × ${p.coverageDays} days`,
    basis: {
      population: p.population,
      litersPerPersonPerDay: a.drinkingWaterLitersPerPersonPerDay.value,
      coverageDays: p.coverageDays,
    },
  });

  out.push({
    category: 'blankets',
    label: 'Blankets (adult size, non-electric)',
    quantity: p.population * a.blanketsPerPerson.value,
    unit: 'blankets',
    priority: 'high',
    spec: {
      mustMatchAny: ['\\bblankets?\\b', '\\bthrow blankets?\\b'],
      mustNotMatch: [
        ...COMMON_PROHIBITED,
        'electric',
        'heated',
        'weighted',
        '\\bpet\\b',
        '\\bdog\\b',
        '\\bcat\\b',
        '\\bbaby\\b',
        'swaddle',
        'receiving',
        '\\bdoll\\b',
        'blanket (?:hanger|ladder|rack|storage|bag)',
      ],
      numeric: [],
    },
    searchQuery: 'fleece blankets bulk pack',
    rationale: `${p.population} people × ${a.blanketsPerPerson.value} blanket`,
    basis: { population: p.population, blanketsPerPerson: a.blanketsPerPerson.value },
  });

  const households = Math.ceil(p.population / p.householdSize);
  out.push({
    category: 'hygiene',
    label: 'Hygiene kits (pre-assembled)',
    quantity: households * a.hygieneKitsPerHousehold.value,
    unit: 'kits',
    priority: 'high',
    spec: {
      mustMatchAny: ['hygiene kits?', 'toiletr(?:y|ies) kits?', 'personal care kits?', 'hygiene (?:packs?|bags?)'],
      mustNotMatch: [...COMMON_PROHIBITED, 'empty', 'organi[sz]er', 'toiletry bag(?! with)', '\\bdopp\\b', 'travel bottles'],
      numeric: [],
    },
    searchQuery: 'hygiene kits bulk individually packed',
    rationale: `${p.population} people ÷ ${p.householdSize} per household = ${households} households × 1 kit`,
    basis: { population: p.population, householdSize: p.householdSize, households },
  });

  const powerBanks = Math.ceil(p.population / a.peoplePerPowerBank.value);
  out.push({
    category: 'power',
    label: 'Phone chargers (power banks ≥ 10,000 mAh)',
    quantity: powerBanks,
    unit: 'power banks',
    priority: 'standard',
    spec: {
      mustMatchAny: ['power ?banks?', 'portable (?:phone )?chargers?', 'battery packs?'],
      mustNotMatch: [...COMMON_PROHIBITED, '\\bcase\\b', 'holder', 'cable only', 'replacement battery', 'jump starter'],
      numeric: [{ attribute: 'capacity_mAh', min: a.minPowerBankCapacityMah.value }],
    },
    searchQuery: 'portable power bank 10000mAh phone charger',
    rationale: `${p.population} people ÷ ${a.peoplePerPowerBank.value} per power bank`,
    basis: { population: p.population, peoplePerPowerBank: a.peoplePerPowerBank.value },
  });

  if (p.infants > 0) {
    const diapers = p.infants * a.diapersPerInfantPerDay.value * p.coverageDays;
    out.push({
      category: 'baby',
      label: 'Baby supplies — disposable diapers',
      quantity: diapers,
      unit: 'diapers',
      priority: 'critical',
      spec: {
        mustMatchAny: ['\\bdiapers?\\b'],
        mustNotMatch: [
          ...COMMON_PROHIBITED,
          '\\bcloth\\b',
          'reusable',
          '\\bpail\\b',
          'diaper (?:bag|cake|cover|caddy|rash|cream|genie|changing)',
          '\\bswim\\b',
          '\\badult\\b',
          '\\bpet\\b',
          '\\bdog\\b',
          'liners?',
        ],
        numeric: [],
      },
      searchQuery: 'disposable baby diapers size 3 bulk',
      rationale: `${p.infants} infants × ${a.diapersPerInfantPerDay.value}/day × ${p.coverageDays} days`,
      basis: {
        infants: p.infants,
        diapersPerInfantPerDay: a.diapersPerInfantPerDay.value,
        coverageDays: p.coverageDays,
      },
    });
  }

  return out;
}
