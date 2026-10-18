// Lifecycle state machines. Every persisted status change goes through `assertTransition`, so an
// illegal transition is a programming error that surfaces immediately rather than corrupt state.

export const MISSION_STATUSES = [
  'DRAFT',
  'PLANNING',
  'NEEDS_REVIEW',
  'READY_FOR_APPROVAL',
  'EXECUTING',
  'PARTIALLY_FULFILLED',
  'COMPLETED',
  'BLOCKED',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const PROPOSAL_STATUSES = [
  'DRAFT',
  'VALIDATED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTION_PENDING',
  'EXECUTED',
  'REJECTED',
  'INVALIDATED',
  'FAILED',
  'UNKNOWN',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

// Adapted to the PayPal Orders v2 lifecycle. A created order, payer approval, an in-flight capture and
// a verified completed capture are deliberately separate states.
export const PAYMENT_STATUSES = [
  'NOT_CREATED', // operation recorded; PayPal create-order not yet acknowledged
  'CREATED', // PayPal acknowledged the order (status CREATED / PAYER_ACTION_REQUIRED)
  'APPROVAL_PENDING', // order handed to the payer for approval in PayPal
  'CAPTURE_PENDING', // payer approval verified server-side; capture request in flight
  'PROVIDER_PENDING', // PayPal returned capture status PENDING; funds not yet settled
  'COMPLETED', // capture COMPLETED, verified by a server-side GET of the order
  'FAILED', // definitive failure reported by PayPal
  'CANCELLED', // payer cancelled, or RELIEFOS withdrew the order before capture
  'UNKNOWN', // outcome ambiguous (timeout, 5xx, network); must be reconciled before any retry
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

type TransitionTable<S extends string> = Record<S, readonly S[]>;

export const MISSION_TRANSITIONS: TransitionTable<MissionStatus> = {
  DRAFT: ['PLANNING'],
  PLANNING: ['NEEDS_REVIEW', 'READY_FOR_APPROVAL', 'BLOCKED', 'PLANNING'],
  NEEDS_REVIEW: ['PLANNING', 'READY_FOR_APPROVAL', 'BLOCKED', 'NEEDS_REVIEW'],
  READY_FOR_APPROVAL: ['EXECUTING', 'NEEDS_REVIEW', 'PLANNING', 'READY_FOR_APPROVAL'],
  EXECUTING: ['PARTIALLY_FULFILLED', 'COMPLETED', 'NEEDS_REVIEW', 'READY_FOR_APPROVAL', 'EXECUTING'],
  PARTIALLY_FULFILLED: ['PLANNING', 'COMPLETED', 'NEEDS_REVIEW'],
  COMPLETED: [],
  BLOCKED: ['PLANNING', 'NEEDS_REVIEW'],
};

export const PROPOSAL_TRANSITIONS: TransitionTable<ProposalStatus> = {
  DRAFT: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['AWAITING_APPROVAL', 'INVALIDATED', 'REJECTED'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'INVALIDATED'],
  APPROVED: ['EXECUTION_PENDING', 'INVALIDATED'],
  EXECUTION_PENDING: ['EXECUTED', 'FAILED', 'UNKNOWN', 'APPROVED', 'INVALIDATED'],
  UNKNOWN: ['EXECUTED', 'FAILED', 'EXECUTION_PENDING', 'APPROVED'],
  EXECUTED: [],
  REJECTED: [],
  INVALIDATED: [],
  FAILED: [],
};

export const PAYMENT_TRANSITIONS: TransitionTable<PaymentStatus> = {
  NOT_CREATED: ['CREATED', 'FAILED', 'UNKNOWN'],
  CREATED: ['APPROVAL_PENDING', 'CANCELLED', 'FAILED'],
  APPROVAL_PENDING: ['CAPTURE_PENDING', 'CANCELLED', 'FAILED'],
  CAPTURE_PENDING: ['COMPLETED', 'PROVIDER_PENDING', 'FAILED', 'UNKNOWN', 'APPROVAL_PENDING'],
  PROVIDER_PENDING: ['COMPLETED', 'FAILED', 'UNKNOWN', 'PROVIDER_PENDING'],
  // Only reconciliation (an authoritative read from PayPal) may move an operation out of UNKNOWN.
  UNKNOWN: [
    'CREATED',
    'APPROVAL_PENDING',
    'CAPTURE_PENDING',
    'PROVIDER_PENDING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'UNKNOWN',
  ],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
/** Payment states that still hold (or may hold) a claim on the budget and block a duplicate purchase. */
export const BLOCKING_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'NOT_CREATED',
  'CREATED',
  'APPROVAL_PENDING',
  'CAPTURE_PENDING',
  'PROVIDER_PENDING',
  'UNKNOWN',
  'COMPLETED',
];
export const UNRESOLVED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['UNKNOWN', 'PROVIDER_PENDING'];

export class IllegalTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${entity} transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

export function assertTransition<S extends string>(
  entity: 'mission' | 'proposal' | 'payment',
  table: TransitionTable<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to)) throw new IllegalTransitionError(entity, from, to);
}
