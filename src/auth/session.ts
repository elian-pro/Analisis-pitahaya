import crypto from 'crypto';
import type { Request, Response } from 'express';
import { authConfig } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// Sesión sin estado: un token HMAC-SHA256 firmado, guardado en una cookie
// httpOnly. No requiere almacén de sesiones ni base de datos; la firma con el
// secreto del servidor garantiza que el cliente no pueda falsificarla.
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME = 'zr_session';
const MAX_AGE_MS  = 12 * 60 * 60 * 1000; // 12 horas

export interface SessionUser {
  email: string;
  name?: string;
}

function sign(data: string): string {
  return crypto.createHmac('sha256', authConfig.sessionSecret).update(data).digest('base64url');
}

function createToken(user: SessionUser): string {
  const payload = { sub: user.email, name: user.name ?? '', exp: Date.now() + MAX_AGE_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function verifyToken(token: string): SessionUser | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;

  const body = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = sign(body);

  // Comparación en tiempo constante; longitudes distintas => inválido.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string') return null;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return { email: payload.sub, name: payload.name || undefined };
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function getSessionUser(req: Request): SessionUser | null {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return token ? verifyToken(token) : null;
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  res.cookie(COOKIE_NAME, createToken(user), {
    httpOnly: true,
    secure:   authConfig.cookieSecure,
    sameSite: 'lax',
    maxAge:   MAX_AGE_MS,
    path:     '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure:   authConfig.cookieSecure,
    sameSite: 'lax',
    path:     '/',
  });
}
