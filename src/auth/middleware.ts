import type { Request, Response, NextFunction } from 'express';
import { authConfig } from './config';
import { getSessionUser, type SessionUser } from './session';
import { matchPolicy } from './policy';
import { sessionStillValid } from './users';
import { getJob } from '../jobs/store';

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

// Aplica la política de autorización (auth/policy.ts) a todo /api/*. Se monta
// UNA vez, justo después de requireApiAuth; ningún handler repite el control.
//
// Un admin pasa intacto. Un cliente externo:
//   • solo alcanza rutas 'tenant' (todo lo demás → 403),
//   • queda acotado a su client_id según `own` (se fuerza query/body, se valida
//     el :id, y un job ajeno responde 404 para no confirmar que existe),
//   • y su sesión se revalida contra la base (revocación en ≤60 s).
export async function enforcePolicy(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user || user.role === 'admin') return next();

  // Revocación: usuario desactivado o contraseña reseteada → fuera.
  if (!(await sessionStillValid(user.email, user.v))) {
    res.status(401).json({ error: 'Tu sesion ya no es valida. Inicia sesion de nuevo.' });
    return;
  }

  const m = matchPolicy(req.method, req.path.startsWith('/api') ? req.path : `/api${req.path}`);
  if (!m || m.entry.rol === 'admin') {
    res.status(403).json({ error: 'No tienes permiso para esta operacion.' });
    return;
  }
  const cid = user.client_id!;
  switch (m.entry.own) {
    case 'query': {
      const asked = req.query.client_id;
      if (typeof asked === 'string' && asked && asked !== cid) {
        res.status(403).json({ error: 'No tienes permiso sobre ese cliente.' });
        return;
      }
      (req.query as Record<string, unknown>).client_id = cid;
      break;
    }
    case 'body': {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.client_id === 'string' && body.client_id && body.client_id !== cid) {
        res.status(403).json({ error: 'No tienes permiso sobre ese cliente.' });
        return;
      }
      body.client_id = cid;
      req.body = body;
      break;
    }
    case 'param': {
      if (m.params.id !== cid) {
        res.status(403).json({ error: 'No tienes permiso sobre ese cliente.' });
        return;
      }
      break;
    }
    case 'job': {
      const job = getJob(m.params.jobId ?? '');
      if (!job || job.client_id !== cid) {
        res.status(404).json({ error: 'Job no encontrado.' });
        return;
      }
      break;
    }
    // 'handler': el handler filtra con req.user (listados y ramas tenant).
  }
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
