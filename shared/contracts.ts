import { z } from 'zod';

// Request contracts, validated at the API boundary and reused by the client for form validation.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const MissionInputSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    organization: z.string().trim().min(2).max(120),
    narrative: z.string().trim().min(10).max(4000),
    budgetUsd: z.number().positive().max(100_000),
    population: z.number().int().min(1).max(10_000),
    infants: z.number().int().min(0).max(5_000),
    householdSize: z.number().int().min(1).max(20),
    coverageDays: z.number().int().min(1).max(14),
    destination: z.string().trim().min(2).max(120),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    startTime: time,
    deadlineTime: time,
    timezone: z.string().min(1).max(64),
    plannerMode: z.enum(['claude', 'deterministic']).default('claude'),
  })
  .refine((v) => v.deadlineTime > v.startTime, { message: 'Deadline must be after the planning window starts', path: ['deadlineTime'] })
  .refine((v) => v.infants <= v.population, { message: 'Infants cannot exceed the population', path: ['infants'] });
export type MissionInput = z.infer<typeof MissionInputSchema>;

export const MissionUpdateSchema = z.object({ expectedVersion: z.number().int().positive(), mission: MissionInputSchema });

export const InterpretRequestSchema = z.object({ narrative: z.string().trim().min(10).max(4000) });

export const PlanRequestSchema = z.object({ refreshCatalog: z.boolean().default(false) });

export const ApproveRequestSchema = z.object({
  approverName: z.string().trim().min(2).max(80),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedTotalCents: z.number().int().positive(),
  acknowledged: z.literal(true),
});

export const RejectRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const CreatePaymentRequestSchema = z.object({ approvalId: z.string().uuid() });

export const CaptureRequestSchema = z.object({ orderId: z.string().min(5).max(64) });

export const MARKET_EVENTS = ['price-surge', 'delivery-slip', 'shipping-surge', 'injected-listing'] as const;
export type MarketEventKind = (typeof MARKET_EVENTS)[number];
export const MarketEventRequestSchema = z.object({ kind: z.enum(MARKET_EVENTS) });

export const MARKET_EVENT_INFO: Record<MarketEventKind, { title: string; description: string }> = {
  'price-surge': {
    title: 'Supplier reprices after selection',
    description: 'The supplier of the highest-spend line raises its price 60% after the plan was made.',
  },
  'delivery-slip': {
    title: 'Carrier delay on a critical item',
    description: 'The courier for a critical-priority line slips its ETA past the shelter deadline.',
  },
  'shipping-surge': {
    title: 'Surge courier fee',
    description: 'One supplier adds a $600 surge dispatch fee, pushing shipping costs up.',
  },
  'injected-listing': {
    title: 'Prompt-injected listing and compromised agent output',
    description:
      'A listing embeds instructions telling purchasing agents to buy 500 units; RELIEFOS submits the plan a manipulated agent would produce.',
  },
};
