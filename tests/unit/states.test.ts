import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
  MISSION_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
} from '../../shared/states.js';

describe('state machines', () => {
  it('never lets a payment jump from created or approval-pending to completed', () => {
    expect(canTransition(PAYMENT_TRANSITIONS, 'CREATED', 'COMPLETED')).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, 'APPROVAL_PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, 'CAPTURE_PENDING', 'COMPLETED')).toBe(true);
  });
  it('treats completed, failed and cancelled payments as terminal', () => {
    for (const s of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) expect(PAYMENT_TRANSITIONS[s]).toHaveLength(0);
  });
  it('requires approval before a proposal can execute', () => {
    expect(canTransition(PROPOSAL_TRANSITIONS, 'VALIDATED', 'EXECUTION_PENDING')).toBe(false);
    expect(canTransition(PROPOSAL_TRANSITIONS, 'AWAITING_APPROVAL', 'EXECUTION_PENDING')).toBe(false);
    expect(canTransition(PROPOSAL_TRANSITIONS, 'APPROVED', 'EXECUTION_PENDING')).toBe(true);
  });
  it('does not allow an executed proposal to change state again', () => {
    expect(PROPOSAL_TRANSITIONS.EXECUTED).toHaveLength(0);
  });
  it('throws a typed error on illegal transitions', () => {
    expect(() => assertTransition('mission', MISSION_TRANSITIONS, 'COMPLETED', 'PLANNING')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('mission', MISSION_TRANSITIONS, 'DRAFT', 'PLANNING')).not.toThrow();
  });
});
