import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

// The built-in RELIEFOS mission dashboard: three pages (Mission, Sourcing, Assurance). Field ids
// ('lines.lineTotal') refer to the data sources in ./data.ts.

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'countd' | 'avg' }) => ({
  type: 'value' as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text },
    style: { typography: { fontSize: 24, fontWeight: 'bold' as const } },
  },
});

const activeOnly = { field: { id: 'lines.isActive' }, model: { operator: 'isTrue' as const } };

export const PAGES = [
  { id: 'mission', title: 'Mission' },
  { id: 'sourcing', title: 'Sourcing' },
  { id: 'assurance', title: 'Assurance' },
] as const;

const mission: AgPageState = {
  id: 'mission',
  widgets: {
    authority: {
      type: 'relief-authority',
      dataMapping: { value: [sum('lines.lineTotal')] },
      format: title('Budget authority (current plan goods)'),
    } as never,
    gate: {
      type: 'relief-gate',
      dataMapping: {},
      format: title('DEADMAN verdict on current proposal'),
    } as never,
    'kpi-lines': kpi('Lines in current plan', countd('lines.id')),
    'kpi-units': kpi('Units covered', sum('lines.units')),
    'spend-by-category': {
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'requirements.category' }],
        valueKey: [sum('lines.lineTotal')],
      },
      format: title('Planned goods spend by category'),
    },
    coverage: {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'requirements.requirement' }],
        valueKey: [
          sum('requirements.needed'),
          sum('requirements.planned'),
          sum('requirements.purchased'),
        ],
      },
      format: {
        ...title('Need vs planned vs purchased'),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    lines: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'requirements.requirement' },
          { id: 'lines.product' },
          { id: 'lines.merchant' },
          { id: 'lines.provenance' },
          sum('lines.packs'),
          sum('lines.units'),
          sum('lines.lineTotal'),
          { id: 'lines.slackMinutes' },
          { id: 'lines.deliveryStatus' },
        ],
      },
      sort: [{ field: sum('lines.lineTotal'), direction: 'desc' }],
      format: title('Current plan lines'),
    },
  },
  widgetLayout: {
    authority: at(0, 0, 12, 9),
    gate: at(12, 0, 12, 9),
    'kpi-lines': at(0, 9, 6, 7),
    'kpi-units': at(6, 9, 6, 7),
    'spend-by-category': at(12, 9, 12, 16),
    coverage: at(0, 16, 12, 18),
    lines: at(0, 34, 24, 22),
  },
  filter: { page: [activeOnly] },
} as unknown as AgPageState;

const sourcing: AgPageState = {
  id: 'sourcing',
  widgets: {
    'kpi-candidates': kpi('Listings evaluated', countd('candidates.id')),
    eligibility: {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'requirements.category' }],
        valueKey: [countd('candidates.id')],
        legendKey: [{ id: 'candidates.eligible' }],
      },
      format: {
        ...title('Eligible vs excluded listings by category'),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    provenance: {
      type: 'donut-chart',
      dataMapping: {
        categoryKey: [{ id: 'candidates.provenance' }],
        valueKey: [countd('candidates.id')],
      },
      format: title('Listings by data source'),
    },
    exclusions: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'requirements.requirement' },
          { id: 'candidates.product' },
          { id: 'candidates.merchant' },
          { id: 'candidates.provenance' },
          { id: 'candidates.costPerUnit', aggregation: 'avg' },
          { id: 'candidates.eligible' },
          { id: 'candidates.selected' },
          { id: 'candidates.exclusion' },
        ],
      },
      format: title('Every listing and why it was or was not eligible'),
    },
  },
  widgetLayout: {
    'kpi-candidates': at(0, 0, 6, 16),
    eligibility: at(6, 0, 10, 16),
    provenance: at(16, 0, 8, 16),
    exclusions: at(0, 16, 24, 26),
  },
} as unknown as AgPageState;

const assurance: AgPageState = {
  id: 'assurance',
  widgets: {
    'checks-by-rule': {
      type: 'bar-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'checks.check' }],
        valueKey: [countd('checks.id')],
        legendKey: [{ id: 'checks.passed' }],
      },
      format: {
        ...title('Policy check outcomes across all evaluations'),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    security: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'security.scenario' },
          { id: 'security.passed' },
          { id: 'security.enforcedBy' },
          { id: 'security.observed' },
        ],
      },
      format: title('Latest adversarial suite'),
    },
    payments: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'payments.proposalVersion' },
          { id: 'payments.status' },
          sum('payments.amount'),
          { id: 'payments.orderId' },
          { id: 'payments.captureId' },
          { id: 'payments.verified' },
        ],
      },
      format: title('PayPal payment operations'),
    },
  },
  widgetLayout: {
    'checks-by-rule': at(0, 0, 12, 24),
    security: at(12, 0, 12, 24),
    payments: at(0, 24, 24, 16),
  },
} as unknown as AgPageState;

export const missionReport: AgReportState = {
  selectedPageId: 'mission',
  pages: [mission, sourcing, assurance],
} as unknown as AgReportState;
