import { Router } from 'express';
import { z } from 'zod';
import { authConfig } from './config';
import { verifyGoogleIdToken, emailAllowed } from './google';
import { getClient } from '../clients/manager';
import { setSessionCookie, clearSessionCookie, getSessionUser } from './session';
import { verifyPassword, hashPassword } from './password';
import { loginThrottle } from './rateLimit';
import { getUser, saveUser, usersEnabled } from './users';

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
router.get('/me', async (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }
  // El nombre comercial del tenant, para que la SPA no tenga que pedir /api/clients.
  let client_name: string | undefined;
  if (user.role === 'client' && user.client_id) {
    try { client_name = (await getClient(user.client_id))?.name; } catch { /* informativo */ }
  }
  res.json({ email: user.email, name: user.name, role: user.role, client_id: user.client_id, client_name });
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
    setSessionCookie(res, { email: identity.email, name: identity.name, role: 'admin' });
    res.json({ email: identity.email, name: identity.name });
  } catch (e) {
    res.status(401).json({ error: 'No se pudo verificar la sesion de Google: ' + (e as Error).message });
  }
});

// Login de cliente externo: usuario y contraseña creados por el admin.
// Un solo mensaje de error: nunca distinguir "no existe" de "clave mala".
router.post('/password', async (req, res) => {
  const parsed = z.object({ email: z.string().min(3), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Faltan correo o contraseña.' });
    return;
  }
  if (!usersEnabled()) {
    res.status(503).json({ error: 'El acceso por contraseña no está disponible.' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const key = `${email}|${req.ip ?? ''}`;
  if (!loginThrottle.allowed(key)) {
    res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    return;
  }
  const user = await getUser(email);
  if (!user || !user.activo || !verifyPassword(parsed.data.password, user.hash)) {
    res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    return;
  }
  loginThrottle.clear(key);
  setSessionCookie(res, { email: user.email, name: user.name, role: 'client', client_id: user.client_id, v: user.v });
  res.json({ email: user.email, name: user.name, role: 'client', client_id: user.client_id });
});

// Cambio de contraseña del propio usuario externo (requiere la actual).
// Sube `v`, así que revoca las demás cookies vivas, y renueva la de esta sesión.
router.post('/change-password', async (req, res) => {
  const user = getSessionUser(req);
  if (!user || user.role !== 'client') {
    res.status(403).json({ error: 'Solo los usuarios con contraseña pueden cambiarla aquí.' });
    return;
  }
  const parsed = z.object({ current: z.string().min(1), next: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'La contraseña nueva necesita al menos 8 caracteres.' });
    return;
  }
  const record = await getUser(user.email);
  if (!record || !record.activo || !verifyPassword(parsed.data.current, record.hash)) {
    res.status(401).json({ error: 'La contraseña actual no es correcta.' });
    return;
  }
  record.hash = hashPassword(parsed.data.next);
  record.v += 1;
  await saveUser(record);
  setSessionCookie(res, { email: record.email, name: record.name, role: 'client', client_id: record.client_id, v: record.v });
  res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
