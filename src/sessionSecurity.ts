import { randomBytes, timingSafeEqual } from 'node:crypto';
import type express from 'express';

export const SESSION_COOKIE = 'jc_session';
export const BOOTSTRAP_TTL_MS = 60_000;
export const SESSION_IDLE_TTL_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60_000;

export interface SecureSession {
  id: string;
  token: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  usedIdempotencyKeys: Map<string, number>;
}

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function makeSession(): SecureSession {
  const now = Date.now();
  return {
    id: `sess-${opaqueToken(8)}`,
    token: opaqueToken(),
    csrfToken: opaqueToken(),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_ABSOLUTE_TTL_MS,
    usedIdempotencyKeys: new Map()
  };
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api',
    `Max-Age=${Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000)}`,
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

export function expiredSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api',
    'Max-Age=0',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) && normalized.startsWith('127.'));
}

export function exactAuthority(req: express.Request): string {
  const host = req.get('host') || `127.0.0.1:${req.socket.localPort}`;
  return `${req.protocol}://${host}`;
}

export function validateHostAndOrigin(req: express.Request, consequential: boolean): string | null {
  const raw = req.get('host');
  if (!raw || /[\s/@\\?#]/.test(raw)) return 'HOST_MISMATCH: invalid host header';
  let parsed: URL;
  try {
    parsed = new URL(`http://${raw}`);
  } catch {
    return 'HOST_MISMATCH: invalid host header';
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isLoopbackHostname(hostname)) return 'HOST_MISMATCH: only loopback hosts are accepted';
  const requestedPort = parsed.port
    ? Number(parsed.port)
    : (req.protocol === 'https' ? 443 : 80);
  if (!Number.isInteger(requestedPort) || requestedPort !== req.socket.localPort) {
    return `HOST_MISMATCH: expected loopback port ${req.socket.localPort}`;
  }
  if (consequential && req.get('origin') !== exactAuthority(req)) {
    return `ORIGIN_MISMATCH: expected ${exactAuthority(req)}`;
  }
  return null;
}
