// Domain types shared by the API and the web client. These are the shapes the API returns; the
// server builds them from persisted rows, and the client renders them without re-deriving anything.

import type { CurrencyCode } from './money.js';
import type { MissionStatus, PaymentStatus, ProposalStatus } from './states.js';

export type Priority = 'critical' | 'high' | 'standard';
export type RequirementCategory = 'water' | 'blankets' | 'hygiene' | 'power' | 'baby';

/** Where a value came from. Anything not `channel3` is never presented as verified market data. */
export type Provenance = 'channel3' | 'fixture' | 'simulated-adversarial';
export type PlannerMode = 'claude' | 'deterministic';

export interface NumericSpec {
  attribute: 'capacity_mAh';
  min?: number;
  max?: number;
}

export interface RequirementSpec {
  /** Case-insensitive regex sources; at least one must match the product title/description. */
  mustMatchAny: string[];
  /** Case-insensitive regex sources; none may match. */
  mustNotMatch: string[];
  numeric: NumericSpec[];
}

export interface Requirement {
  id: string;
  missionId: string;
  category: RequirementCategory;
  label: string;
  /** Quantity in `unit` (e.g. liters, people-blankets, kits). Derived deterministically. */
  quantity: number;
  unit: string;
  priority: Priority;
  spec: RequirementSpec;
  searchQuery: string;
  rationale: string;
  basis: Record<string, number | string>;
}

export interface ContentFlag {
  rule: string;
  field: 'title' | 'description' | 'merchant';
  excerpt: string;
  severity: 'block' | 'warn';
}

export interface PackInfo {
  /** How many requirement units one purchasable pack covers; null when it could not be established. */
  unitsPerPack: number | null;
  basis: 'parsed-title' | 'parsed-description' | 'catalog-field' | 'unknown';
  evidence: string | null;
}

export interface SpecCheck {
  passed: boolean;
  reasons: string[];
}

export interface ProductCandidate {
  id: string;
  missionId: string;
  requirementId: string;
  provenance: Provenance;
  sourceProductId: string;
  title: string;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  buyUrl: string | null;
  merchantDomain: string | null;
  priceCents: number | null;
  currency: string;
  listedAvailability: string | null;
  pack: PackInfo;
  attributes: Record<string, number | string>;
  specCheck: SpecCheck;
  contentFlags: ContentFlag[];
  quarantined: boolean;
  suitability: { score: number; notes: string; evaluator: PlannerMode } | null;
  retrievedAt: string;
}

/** A supplier fulfilment commitment. Always simulated in this build: no merchant API exposes these. */
export interface FulfillmentQuote {
  id: string;
  candidateId: string;
  missionId: string;
  simulated: true;
  stockPacks: number;
  unitPriceCents: number;
  shippingBaseCents: number;
  shippingPerPackCents: number;
  dispatchAt: string;
  eta: string;
  carrier: string;
  reason: string;
  quotedAt: string;
  current: boolean;
}

export interface ProposalLine {
  id: string;
  requirementId: string;
  candidateId: string;
  quoteId: string;
  title: string;
  merchantDomain: string;
  provenance: Provenance;
  quantityPacks: number;
  unitsCovered: number;
  unitPriceCents: number;
  lineTotalCents: number;
  eta: string;
}

export interface Gap {
  requirementId: string;
  label: string;
  neededUnits: number;
  plannedUnits: number;
  shortfallUnits: number;
  reason: string;
}

export interface ShippingCharge {
  merchantDomain: string;
  cents: number;
}

export type PolicyStage = 'validation' | 'approval' | 'execution' | 'capture';
export type PolicyOutcome = 'ALLOW' | 'DENY';

export interface PolicyViolation {
  checkId: string;
  message: string;
  lineId: string | null;
  evidence: Record<string, unknown>;
}

export interface PolicyCheckResult {
  checkId: string;
  title: string;
  hard: boolean;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  id: string;
  missionId: string;
  proposalId: string;
  proposalVersion: number;
  contentHash: string;
  stage: PolicyStage;
  outcome: PolicyOutcome;
  checks: PolicyCheckResult[];
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  engineVersion: string;
  evaluatedAt: string;
}

export interface Proposal {
  id: string;
  missionId: string;
  version: number;
  status: ProposalStatus;
  parentProposalId: string | null;
  createdBy: string;
  plannerMode: PlannerMode;
  rationale: string;
  tradeoffs: string[];
  currency: CurrencyCode;
  subtotalCents: number;
  shippingCents: number;
  shipping: ShippingCharge[];
  totalCents: number;
  contentHash: string;
  lines: ProposalLine[];
  gaps: Gap[];
  createdAt: string;
  updatedAt: string;
  latestDecision: PolicyDecision | null;
}

export type ApprovalStatus = 'ACTIVE' | 'CONSUMED' | 'INVALIDATED';

export interface Approval {
  id: string;
  missionId: string;
  proposalId: string;
  proposalVersion: number;
  contentHash: string;
  missionVersion: number;
  amountCents: number;
  currency: CurrencyCode;
  approverName: string;
  statement: string;
  status: ApprovalStatus;
  invalidatedReason: string | null;
  createdAt: string;
}

export interface PaymentOperation {
  id: string;
  missionId: string;
  proposalId: string;
  proposalVersion: number;
  approvalId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: CurrencyCode;
  provider: 'paypal';
  providerEnvironment: 'sandbox' | 'live';
  providerOrderId: string | null;
  providerCaptureId: string | null;
  providerOrderStatus: string | null;
  providerCaptureStatus: string | null;
  providerDebugId: string | null;
  lastError: { code: string; message: string } | null;
  approveUrl: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryTaskKind = 'delivery' | 'intake' | 'distribution';
export type DeliveryTaskStatus = 'PLANNED' | 'AT_RISK' | 'CONFLICT' | 'CONFIRMED' | 'SUPERSEDED';

export interface DeliveryTask {
  id: string;
  missionId: string;
  proposalId: string;
  proposalVersion: number;
  kind: DeliveryTaskKind;
  label: string;
  resource: string;
  startAt: string;
  endAt: string;
  status: DeliveryTaskStatus;
  dependsOn: string[];
  lineIds: string[];
  note: string | null;
  simulated: boolean;
}

export interface AuditEvent {
  id: number;
  missionId: string | null;
  type: string;
  actor: string;
  summary: string;
  data: Record<string, unknown>;
  hash: string;
  prevHash: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  missionId: string;
  role: 'interpreter' | 'buyer' | 'explainer' | 'recovery';
  mode: PlannerMode;
  model: string | null;
  inputSummary: string;
  output: unknown;
  valid: boolean;
  error: string | null;
  latencyMs: number;
  createdAt: string;
}

export type SecurityScenarioId =
  | 'prompt-injection'
  | 'price-change-after-selection'
  | 'shipping-exceeds-budget'
  | 'unauthorized-quantity-substitution'
  | 'duplicate-after-timeout'
  | 'ambiguous-payment-response'
  | 'delivery-deadline-violation'
  | 'mission-change-after-approval';

export interface SecurityScenarioResult {
  scenarioId: SecurityScenarioId;
  title: string;
  attack: string;
  expected: string;
  observed: string;
  passed: boolean;
  enforcedBy: string[];
  evidence: Record<string, unknown>;
  durationMs: number;
}

export interface SecurityTestRun {
  id: string;
  missionId: string;
  suiteVersion: string;
  startedAt: string;
  finishedAt: string;
  passed: number;
  failed: number;
  results: SecurityScenarioResult[];
}

export interface Mission {
  id: string;
  title: string;
  organization: string;
  narrative: string;
  budgetCents: number;
  currency: CurrencyCode;
  population: number;
  infants: number;
  householdSize: number;
  coverageDays: number;
  destination: string;
  windowStart: string;
  deadline: string;
  timezone: string;
  status: MissionStatus;
  version: number;
  plannerMode: PlannerMode;
  catalogSource: Provenance;
  scenarioKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissionInterpretationField {
  field: string;
  value: string | number | null;
  evidence: string | null;
  status: 'extracted' | 'defaulted' | 'missing';
}

export interface MissionInterpretation {
  mode: PlannerMode;
  fields: MissionInterpretationField[];
  ambiguities: string[];
}

export interface MissionSummary {
  budgetCents: number;
  committedCents: number;
  pendingCents: number;
  remainingCents: number;
  plannedCents: number;
  requirementsTotal: number;
  requirementsCovered: number;
  coveragePct: number;
  openGaps: Gap[];
  nextAction: { code: string; label: string };
  unresolvedPayments: number;
}

export interface MissionDetail {
  mission: Mission;
  summary: MissionSummary;
  requirements: Requirement[];
  activeProposal: Proposal | null;
  proposals: Proposal[];
  approvals: Approval[];
  payments: PaymentOperation[];
}

export interface IntegrationStatus {
  id: 'paypal' | 'channel3' | 'anthropic' | 'database' | 'ag-studio' | 'render-workflows';
  label: string;
  state: 'live' | 'fallback' | 'not-configured' | 'error';
  detail: string;
}

export interface PublicConfig {
  paypal: { enabled: boolean; clientId: string | null; environment: 'sandbox' | 'live' };
  agStudioLicenseKey: string | null;
  agGridLicenseKey: string | null;
  integrations: IntegrationStatus[];
  build: { version: string; commit: string | null };
}
