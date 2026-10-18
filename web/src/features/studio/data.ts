import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from 'ag-studio';
import type { AnalyticsData } from '../../api/types';

// AG Studio data model for a mission: the same persisted, server-computed tables the rest of the
// app uses (GET /api/missions/:id/analytics), with relationships so widgets can join them.

type Spec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: Spec[]): AgFieldDefinition[] => specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide ? { hide } : {}) }));
const rel = (id: string, source: string, target: string): AgRelationDefinition => {
  const [st, sf] = source.split('.') as [string, string];
  const [tt, tf] = target.split('.') as [string, string];
  return { id, source: { tableId: st, fieldId: sf }, target: { tableId: tt, fieldId: tf }, type: 'many-to-one' };
};

export function buildStudioData(a: AnalyticsData): AgDataSourcesDefinition {
  return {
    description:
      `Procurement analytics for relief mission "${a.mission.title}". Money is USD (dollars). ` +
      'Lines belong to proposal versions; isActive marks the current proposal. Delivery ETAs and stock are simulated supplier commitments. ' +
      'Policy checks come from the deterministic DEADMAN gate.',
    sources: [
      {
        id: 'requirements',
        description: 'What the mission needs, derived deterministically from population and planning assumptions.',
        data: a.requirements,
        fields: fields([
          ['id', 'Requirement ID', 'textFormat', true],
          ['requirement', 'Requirement', 'textFormat'],
          ['category', 'Category', 'textFormat'],
          ['priority', 'Priority', 'textFormat'],
          ['needed', 'Needed', 'integerFormat'],
          ['unit', 'Unit', 'textFormat'],
          ['purchased', 'Purchased', 'integerFormat'],
          ['planned', 'Planned', 'integerFormat'],
          ['gap', 'Gap', 'integerFormat'],
          ['coveragePct', 'Coverage', 'percentageFormat'],
          ['basis', 'Basis', 'textFormat'],
        ]),
      },
      {
        id: 'lines',
        name: 'Proposal lines',
        description: 'Every line of every proposal version. Filter isActive for the current plan.',
        data: a.lines,
        fields: fields([
          ['id', 'Line ID', 'textFormat', true],
          ['proposalId', 'Proposal ID', 'textFormat', true],
          ['requirementId', 'Requirement ID', 'textFormat', true],
          ['proposalVersion', 'Proposal version', 'integerFormat'],
          ['proposalStatus', 'Proposal status', 'textFormat'],
          ['isActive', 'Current proposal', 'booleanFormat'],
          ['product', 'Product', 'textFormat'],
          ['merchant', 'Supplier', 'textFormat'],
          ['provenance', 'Data source', 'textFormat'],
          ['packs', 'Packs', 'integerFormat'],
          ['units', 'Units covered', 'integerFormat'],
          ['unitPrice', 'Unit price', 'currencyFormat'],
          ['currentUnitPrice', 'Current unit price', 'currencyFormat'],
          ['lineTotal', 'Line total', 'currencyFormat'],
          ['eta', 'ETA (simulated)', 'dateTimeFormat'],
          ['slackMinutes', 'Slack before cutoff (min)', 'integerFormat'],
          ['deliveryStatus', 'Delivery status', 'textFormat'],
        ]),
      },
      {
        id: 'candidates',
        name: 'Product candidates',
        description: 'Every retrieved listing with its eligibility decision and evidence.',
        data: a.candidates,
        fields: fields([
          ['id', 'Candidate ID', 'textFormat', true],
          ['requirementId', 'Requirement ID', 'textFormat', true],
          ['product', 'Product', 'textFormat'],
          ['brand', 'Brand', 'textFormat'],
          ['merchant', 'Merchant', 'textFormat'],
          ['provenance', 'Data source', 'textFormat'],
          ['listedPrice', 'Listed price', 'currencyFormat'],
          ['unitsPerPack', 'Units per pack', 'decimalFormat'],
          ['costPerUnit', 'Delivered cost per unit', 'currencyFormat'],
          ['stockPacks', 'Stock (simulated)', 'integerFormat'],
          ['specPassed', 'Meets spec', 'booleanFormat'],
          ['quarantined', 'Quarantined', 'booleanFormat'],
          ['eligible', 'Eligible', 'booleanFormat'],
          ['selected', 'In current plan', 'booleanFormat'],
          ['suitability', 'Agent rank score', 'integerFormat'],
          ['exclusion', 'Exclusion reason', 'textFormat'],
        ]),
      },
      {
        id: 'checks',
        name: 'Policy checks',
        description: 'Each DEADMAN check result for each policy decision.',
        data: a.checks,
        fields: fields([
          ['id', 'Check result ID', 'textFormat', true],
          ['decisionId', 'Decision ID', 'textFormat', true],
          ['proposalVersion', 'Proposal version', 'integerFormat'],
          ['stage', 'Stage', 'textFormat'],
          ['outcome', 'Decision outcome', 'textFormat'],
          ['check', 'Check', 'textFormat'],
          ['title', 'Rule', 'textFormat'],
          ['passed', 'Passed', 'booleanFormat'],
          ['detail', 'Detail', 'textFormat'],
          ['evaluatedAt', 'Evaluated at', 'dateTimeFormat'],
        ]),
      },
      {
        id: 'payments',
        description: 'PayPal Sandbox payment operations and their verified state.',
        data: a.payments,
        fields: fields([
          ['id', 'Operation ID', 'textFormat'],
          ['proposalVersion', 'Proposal version', 'integerFormat'],
          ['status', 'Status', 'textFormat'],
          ['amount', 'Amount', 'currencyFormat'],
          ['orderId', 'PayPal order', 'textFormat'],
          ['captureId', 'PayPal capture', 'textFormat'],
          ['verified', 'Verified', 'booleanFormat'],
          ['updatedAt', 'Updated', 'dateTimeFormat'],
        ]),
      },
      {
        id: 'security',
        name: 'Security scenarios',
        description: 'Latest DEADMAN adversarial suite results.',
        data: a.security,
        fields: fields([
          ['id', 'Scenario ID', 'textFormat', true],
          ['scenario', 'Scenario', 'textFormat'],
          ['passed', 'Enforced', 'booleanFormat'],
          ['observed', 'Observed', 'textFormat'],
          ['enforcedBy', 'Enforced by', 'textFormat'],
          ['durationMs', 'Duration (ms)', 'integerFormat'],
        ]),
      },
    ],
    relationships: [rel('line-requirement', 'lines.requirementId', 'requirements.id'), rel('candidate-requirement', 'candidates.requirementId', 'requirements.id')],
  };
}
