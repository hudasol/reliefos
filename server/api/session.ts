import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DomainError } from '../domain/errors.js';

// Anonymous, signed workspace sessions. Each visitor (e.g. each judge) gets an isolated workspace;
// every mission, proposal, approval and payment query is scoped to it. This is ownership isolation,
// not identity: RELIEFOS does not implement user accounts in this build (documented limitation).

export const SESSION_COOKIE = 'rlf_ws';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function sign(workspaceId: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(workspaceId).digest('base64url');
  return `${workspaceId}.${mac}`;
}

export function verify(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const [id, mac] = token.split('.');
  if (!id || !mac || !UUID.test(id)) return null;
  const expected = createHmac('sha256', secret).update(id).digest();
  const given = Buffer.from(mac, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    workspaceId?: string;
  }
}

/** Require a valid workspace session for /api routes other than session bootstrap and health. */
export function requireWorkspace(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const id = verify(readCookie(req, SESSION_COOKIE), secret);
    if (!id) return next(new DomainError('UNAUTHORIZED', 'No workspace session; reload the application'));
    req.workspaceId = id;
    next();
  };
}

/**
 * CSRF defence for state-changing requests: browsers cannot attach a custom header to a cross-site
 * request without a CORS preflight, which this API never grants. Combined with SameSite=Lax cookies.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-reliefos-request') !== '1') return next(new DomainError('UNAUTHORIZED', 'Missing request header'));
  next();
}
