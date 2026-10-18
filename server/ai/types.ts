import { z } from 'zod';
import type { PlannerMode, RequirementCategory } from '../../shared/types.js';

// Contracts for the AI roles. Models produce ONLY these shapes; every output is schema-validated and
// then re-validated against authoritative state before it influences anything. No role can set a
// budget, approve a purchase, compute a total, or declare a payment outcome.

export const InterpretationSchema = z.object({
  organization: z.string().nullable(),
  title: z.string().nullable(),
  population: z.number().int().positive().nullable(),
  infants: z.number().int().nonnegative().nullable(),
  householdSize: z.number().int().positive().nullable(),
  coverageDays: z.number().int().positive().nullable(),
  budgetUsd: z.number().positive().nullable(),
  /** Local wall-clock deadline, 24h "HH:MM". */
  deadlineLocalTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  planningHorizonHours: z.number().positive().nullable(),
  destination: z.string().nullable(),
  categories: z.array(z.enum(['water', 'blankets', 'hygiene', 'power', 'baby'])),
  /** For each extracted field, the exact phrase from the request that supports it. */
  evidence: z.array(z.object({ field: z.string(), quote: z.string() })),
  ambiguities: z.array(z.string()),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

export const SelectionSchema = z.object({
  selections: z.array(
    z.object({
      requirementId: z.string(),
      /** Ranked preference among the offered candidate ids only. */
      candidateIds: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  suspiciousListings: z.array(z.object({ candidateId: z.string(), reason: z.string() })),
});
export type Selection = z.infer<typeof SelectionSchema>;

export const ExplanationSchema = z.object({
  headline: z.string(),
  points: z.array(z.string()),
  nextStep: z.string(),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

export interface SelectionOption {
  candidateId: string;
  title: string;
  merchantDomain: string;
  provenance: string;
  costPerUnitCents: number;
  unit: string;
  eta: string;
  packEvidence: string;
  /** Untrusted listing text, sanitised. */
  description: string;
}

export interface SelectionInput {
  requirements: {
    id: string;
    label: string;
    category: RequirementCategory;
    quantity: number;
    unit: string;
    priority: string;
  }[];
  options: Record<string, SelectionOption[]>;
}

export interface ExplanationInput {
  kind: 'rejection' | 'recovery' | 'approval-ready';
  missionTitle: string;
  violations: { checkId: string; message: string }[];
  warnings: { checkId: string; message: string }[];
  changes: string[];
  gaps: { label: string; shortfallUnits: number; reason: string }[];
  totalCents: number;
  budgetCents: number;
}

export interface AgentResult<T> {
  output: T;
  mode: PlannerMode;
  model: string | null;
  latencyMs: number;
  /** False when a model was attempted but its output was rejected (fallback output returned). */
  valid: boolean;
  error: string | null;
}

export interface MissionAgent {
  readonly mode: PlannerMode;
  readonly model: string | null;
  interpret(narrative: string): Promise<AgentResult<Interpretation>>;
  select(input: SelectionInput): Promise<AgentResult<Selection>>;
  explain(input: ExplanationInput): Promise<AgentResult<Explanation>>;
}
