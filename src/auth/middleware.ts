import type { Request, Response, NextFunction } from 'express';
import { authConfig } from './config';
import { getSessionUser, type SessionUser } from './session';

// Rutas/recursos públicos que deben servirse sin sesión (los usa la página de
// login). Todo lo demás queda detrás de la sesión cuando la auth está activa.
const PUBLIC_ASSET = /^\/(login(\.html)?|favicon\.(ico|svg)|favicon-\d+\.png|Logo Zebra Blanco\.png)$/;

// Adjunta el usuario a req para que los handlers lo puedan leer.
export interface AuthedRequest extends Request {
  user?: SessionUser;
}

// Protege la API: responde 401 JSON si no hay sesión válida.
export function requireApiAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!authConfig.enabled) return next();
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'No autenticado. Inicia sesion en /login.' });
    return;
  }
  req.user = user;
  next();
}

// Protege las páginas (la SPA y los estáticos que no son públicos): redirige a
// /login las navegaciones sin sesión. Deja pasar los recursos públicos.
export function requirePage(req: Request, res: Response, next: NextFunction): void {
  if (!authConfig.enabled) return next();
  if (req.path.startsWith('/api/')) return next();      // la API la maneja requireApiAuth
  if (req.method === 'GET' && PUBLIC_ASSET.test(req.path)) return next();
  if (getSessionUser(req)) return next();
  res.redirect('/login');
}
