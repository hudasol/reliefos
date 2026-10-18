import type { MissionStatus, PaymentStatus, ProposalStatus } from '../../../shared/states';

export const usd = (cents: number | null | undefined, opts: { compact?: boolean } = {}) =>
  cents == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: opts.compact ? 0 : 2,
        minimumFractionDigits: opts.compact ? 0 : 2,
      }).format(cents / 100);

export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);

/** Wall-clock time in the mission's time zone, e.g. "4:12 PM EDT". */
export const clock = (iso: string | null | undefined, timeZone: string) =>
  iso
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(iso))
    : '—';

export const dateTime = (iso: string | null | undefined, timeZone?: string) =>
  iso
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(iso))
    : '—';

export const minutesBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent' | 'sim';

export const MISSION_TONE: Record<MissionStatus, Tone> = {
  DRAFT: 'neutral',
  PLANNING: 'info',
  NEEDS_REVIEW: 'warn',
  READY_FOR_APPROVAL: 'accent',
  EXECUTING: 'info',
  PARTIALLY_FULFILLED: 'warn',
  COMPLETED: 'ok',
  BLOCKED: 'danger',
};

export const PROPOSAL_TONE: Record<ProposalStatus, Tone> = {
  DRAFT: 'neutral',
  VALIDATED: 'info',
  AWAITING_APPROVAL: 'accent',
  APPROVED: 'ok',
  EXECUTION_PENDING: 'info',
  EXECUTED: 'ok',
  REJECTED: 'danger',
  INVALIDATED: 'warn',
  FAILED: 'danger',
  UNKNOWN: 'warn',
};

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  NOT_CREATED: 'neutral',
  CREATED: 'info',
  APPROVAL_PENDING: 'accent',
  CAPTURE_PENDING: 'info',
  PROVIDER_PENDING: 'warn',
  COMPLETED: 'ok',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  UNKNOWN: 'warn',
};

export const humanize = (s: string) =>
  s
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
