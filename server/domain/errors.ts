// Explicit domain errors. HTTP mapping lives in one place (api/errors.ts) so route handlers stay thin.

export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'ILLEGAL_STATE'
  | 'POLICY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'PAYMENT_UNRESOLVED'
  | 'INTEGRATION_NOT_CONFIGURED'
  | 'INTEGRATION_FAILED'
  | 'UNAUTHORIZED';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new DomainError('CONFLICT', message, details);
export const illegalState = (message: string, details?: Record<string, unknown>) =>
  new DomainError('ILLEGAL_STATE', message, details);
