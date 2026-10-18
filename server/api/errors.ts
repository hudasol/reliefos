import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { IllegalTransitionError } from '../../shared/states.js';
import { DomainError, type DomainErrorCode } from '../domain/errors.js';

const STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  STALE_VERSION: 409,
  ILLEGAL_STATE: 409,
  POLICY_DENIED: 422,
  APPROVAL_REQUIRED: 403,
  PAYMENT_UNRESOLVED: 409,
  INTEGRATION_NOT_CONFIGURED: 503,
  INTEGRATION_FAILED: 502,
  UNAUTHORIZED: 401,
};

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorHandler(log: { error: (o: object, m: string) => void }) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } } satisfies ApiErrorBody);
    }
    if (err instanceof DomainError) {
      return res.status(STATUS[err.code]).json({ error: { code: err.code, message: err.message, details: err.details } } satisfies ApiErrorBody);
    }
    if (err instanceof IllegalTransitionError) {
      return res.status(409).json({ error: { code: 'ILLEGAL_STATE', message: err.message } } satisfies ApiErrorBody);
    }
    if (err instanceof SyntaxError && 'body' in (err as object)) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Malformed JSON body' } } satisfies ApiErrorBody);
    }
    log.error({ err, path: req.path, method: req.method }, 'unhandled error');
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred. It has been logged.' } } satisfies ApiErrorBody);
  };
}
