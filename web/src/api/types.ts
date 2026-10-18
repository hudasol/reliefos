// Client-side shapes of read-model responses. The server modules that build them are the source of
// truth (server/services/readModels.ts, planning.ts, events.ts, securityLab.ts).
import type {
  Approval,
  AuditEvent,
  DeliveryTask,
  FulfillmentQuote,
  Gap,
  Mission,
  MissionSummary,
  PaymentOperation,
  PolicyDecision,
  ProductCandidate,
  Proposal,
  Requirement,
  SecurityTestRun,
} from '../../../shared/types';
import type { MarketEventKind } from '../../../shared/contracts';

export interface CandidateView extends ProductCandidate {
  quote: FulfillmentQuote | null;
  eligible: boolean;
  exclusionReasons: string[];
  costPerUnitCents: number | null;
  selectedInActive: boolean;
}

export interface Explanation {
  headline: string;
  points: string[];
  nextStep: string;
}

export interface PlanOutcome {
  proposal: Proposal;
  decision: PolicyDecision;
  explanation: Explanation;
  exclusions: { candidateId: string; requirementId: string; title: string; reasons: string[] }[];
}

export interface DrillOutcome {
  kind: MarketEventKind;
  title: string;
  changed: string[];
  revalidated: { proposalId: string; version: number; decision: PolicyDecision } | null;
}

export interface SecurityCatalog {
  scenarios: { id: string; title: string; attack: string; expected: string }[];
  checks: { id: string; title: string; hard: boolean; stages: string[] }[];
}

export interface AnalyticsData {
  asOf: string;
  mission: {
    id: string;
    title: string;
    status: string;
    budget: number;
    deadline: string;
    catalogSource: string;
  };
  summary: MissionSummary;
  requirements: {
    id: string;
    requirement: string;
    category: string;
    priority: string;
    needed: number;
    unit: string;
    purchased: number;
    planned: number;
    gap: number;
    coveragePct: number;
    basis: string;
  }[];
  lines: {
    id: string;
    proposalId: string;
    proposalVersion: number;
    proposalStatus: string;
    isActive: boolean;
    requirementId: string;
    requirement: string;
    category: string;
    priority: string;
    product: string;
    merchant: string;
    provenance: string;
    packs: number;
    units: number;
    unitPrice: number;
    currentUnitPrice: number;
    lineTotal: number;
    eta: string;
    slackMinutes: number;
    deliveryStatus: string;
  }[];
  candidates: {
    id: string;
    requirementId: string;
    requirement: string;
    category: string;
    product: string;
    brand: string | null;
    merchant: string | null;
    provenance: string;
    listedPrice: number | null;
    unitsPerPack: number | null;
    packEvidence: string | null;
    costPerUnit: number | null;
    eta: string | null;
    stockPacks: number | null;
    specPassed: boolean;
    quarantined: boolean;
    eligible: boolean;
    selected: boolean;
    suitability: number | null;
    exclusion: string | null;
    exclusionCount: number;
    buyUrl: string | null;
    imageUrl: string | null;
  }[];
  checks: {
    id: string;
    decisionId: string;
    proposalVersion: number;
    stage: string;
    outcome: string;
    check: string;
    title: string;
    passed: boolean;
    hard: boolean;
    detail: string;
    evaluatedAt: string;
  }[];
  payments: {
    id: string;
    proposalVersion: number;
    status: string;
    amount: number;
    orderId: string | null;
    captureId: string | null;
    captureStatus: string | null;
    verified: boolean;
    updatedAt: string;
    error: string | null;
  }[];
  security: {
    id: string;
    scenario: string;
    passed: boolean;
    observed: string;
    enforcedBy: string;
    durationMs: number;
    runAt: string;
  }[];
  spend: { id: string; category: string; requirement: string; planned: number; executed: number }[];
}

export interface MissionReport {
  mission: Mission;
  summary: MissionSummary;
  requirements: Requirement[];
  executedProposals: Proposal[];
  verifiedPayments: PaymentOperation[];
  unresolvedPayments: PaymentOperation[];
  confirmedDeliveries: DeliveryTask[];
  rejectedProposals: {
    version: number;
    status: string;
    createdBy: string;
    violations: { checkId: string; message: string }[];
  }[];
  security: SecurityTestRun | null;
  audit: { events: number; chainIntact: boolean; chainEvents: number; brokenAt: number | null };
  dataProvenance: Record<string, number>;
  assumptions: Record<string, { value: number; source: string }>;
  policyChecks: { id: string; title: string; hard: boolean; stages: string[] }[];
  simulated: string[];
}

export type { Approval, AuditEvent, Gap };
