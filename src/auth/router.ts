import { Router } from 'express';
import { z } from 'zod';
import { authConfig } from './config';
import { verifyGoogleIdToken, emailAllowed } from './google';
import { setSessionCookie, clearSessionCookie, getSessionUser } from './session';

const router = Router();

// Config pública que la página de login necesita para pintar el botón de Google.
router.get('/config', (_req, res) => {
  res.json({
    enabled:  authConfig.enabled,
    clientId: authConfig.clientId,
    domains:  authConfig.allowedDomains,
  });
});

// Quién está autenticado ahora mismo (lo usa la SPA para el chip de sesión).
router.get('/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }
  res.json({ email: user.email, name: user.name });
});

// Intercambia el ID token de "Sign in with Google" por una cookie de sesión,
// tras verificar el token y que el correo pertenezca a un dominio permitido.
router.post('/google', async (req, res) => {
  const parsed = z.object({ credential: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Falta el credential de Google.' });
    return;
  }
  try {
    const identity = await verifyGoogleIdToken(parsed.data.credential);
    if (!emailAllowed(identity.email)) {
      res.status(403).json({
        error: `Acceso restringido. Debes entrar con un correo ${authConfig.allowedDomains.map(d => '@' + d).join(' o ')}.`,
      });
      return;
    }
    setSessionCookie(res, { email: identity.email, name: identity.name });
    res.json({ email: identity.email, name: identity.name });
  } catch (e) {
    res.status(401).json({ error: 'No se pudo verificar la sesion de Google: ' + (e as Error).message });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
