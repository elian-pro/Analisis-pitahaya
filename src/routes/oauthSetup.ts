import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { env, getGoogleOAuthAppCreds } from '../config/env';
import { authConfig } from '../auth/config';
import { SHEETS_DRIVE_SCOPES } from '../google/auth';

// ─────────────────────────────────────────────────────────────────────────────
// Setup OAuth de la cuenta central (Sheets/Drive), hecho DESDE la app desplegada.
// Ambas rutas van montadas bajo /api, así que quedan detrás de requireApiAuth:
// solo un admin con sesión (dominio permitido) puede dispararlas.
//
//   GET /api/oauth/google/start     → redirige al consentimiento de Google
//   GET /api/oauth/google/callback  → recibe el código y muestra el refresh_token
//
// El refresh_token se muestra en pantalla para copiarlo a GOOGLE_OAUTH_REFRESH_TOKEN
// (no se persiste). Tras pegarlo en el entorno y redesplegar, la app usa OAuth.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
const CALLBACK_PATH = '/api/oauth/google/callback';

// El redirect_uri debe coincidir EXACTAMENTE con el registrado en Google Cloud.
// Se toma de APP_BASE_URL si está definida; si no, se deriva del proxy.
function redirectUri(req: Request): string {
  // req.protocol ya respeta X-Forwarded-Proto porque server.ts hace `trust proxy`.
  const base = (env.APP_BASE_URL && env.APP_BASE_URL.trim())
    ? env.APP_BASE_URL.trim()
    : `${req.protocol}://${req.headers.host}`;
  return `${base.replace(/\/+$/, '')}${CALLBACK_PATH}`;
}

// ── CSRF: state firmado (sin almacenamiento en servidor) ─────────────────────
function signState(body: string): string {
  return crypto.createHmac('sha256', authConfig.sessionSecret).update(body).digest('base64url');
}

function makeState(): string {
  const body = Buffer.from(JSON.stringify({
    n:   crypto.randomBytes(16).toString('base64url'),
    exp: Date.now() + 10 * 60 * 1000, // 10 minutos para completar el flujo
  })).toString('base64url');
  return `${body}.${signState(body)}`;
}

function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  const dot = state.indexOf('.');
  if (dot < 0) return false;
  const body = state.slice(0, dot);
  const sig  = state.slice(dot + 1);
  const expected = signState(body);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof p.exp === 'number' && Date.now() <= p.exp;
  } catch {
    return false;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#111;line-height:1.5}
  code,textarea{font-family:ui-monospace,Menlo,monospace}
  textarea{width:100%;min-height:96px;padding:12px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box}
  .ok{color:#0a7d38}.err{color:#c0271a}
  ol{padding-left:20px}li{margin:6px 0}
  a.btn{display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;margin-top:8px}
</style></head><body>${bodyHtml}</body></html>`;
}

// ── Inicio del flujo ─────────────────────────────────────────────────────────
router.get('/google/start', (req: Request, res: Response): void => {
  let creds;
  try {
    creds = getGoogleOAuthAppCreds();
  } catch (e) {
    res.status(500).type('html').send(page('Configuración incompleta',
      `<h1 class="err">Falta configuración</h1><p>${esc((e as Error).message)}</p>
       <p>Define <code>GOOGLE_OAUTH_CLIENT_ID</code> y <code>GOOGLE_OAUTH_CLIENT_SECRET</code> en el entorno y vuelve a intentar.</p>`));
    return;
  }

  const client = new google.auth.OAuth2({
    clientId:     creds.clientId,
    clientSecret: creds.clientSecret,
    redirectUri:  redirectUri(req),
  });

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',   // fuerza refresh_token aunque ya se haya consentido
    scope:       SHEETS_DRIVE_SCOPES,
    state:       makeState(),
  });

  res.redirect(url);
});

// ── Callback ─────────────────────────────────────────────────────────────────
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');

  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  if (error) {
    res.status(400).type('html').send(page('Autorización cancelada',
      `<h1 class="err">Autorización cancelada</h1><p>Google devolvió: <code>${esc(error)}</code></p>
       <p><a class="btn" href="/api/oauth/google/start">Reintentar</a></p>`));
    return;
  }

  if (!verifyState(typeof req.query.state === 'string' ? req.query.state : undefined)) {
    res.status(400).type('html').send(page('Sesión de autorización inválida',
      `<h1 class="err">Sesión de autorización inválida o expirada</h1>
       <p>Inicia el flujo de nuevo.</p><p><a class="btn" href="/api/oauth/google/start">Reintentar</a></p>`));
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  if (!code) {
    res.status(400).type('html').send(page('Falta el código',
      `<h1 class="err">Falta el parámetro "code".</h1>`));
    return;
  }

  try {
    const creds  = getGoogleOAuthAppCreds();
    const client = new google.auth.OAuth2({
      clientId:     creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri:  redirectUri(req),
    });
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      res.status(400).type('html').send(page('Sin refresh token',
        `<h1 class="err">Google no devolvió un refresh token</h1>
         <p>Suele pasar cuando esta cuenta ya había autorizado la app. Revoca el acceso en
         <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>
         y vuelve a intentar.</p>
         <p><a class="btn" href="/api/oauth/google/start">Reintentar</a></p>`));
      return;
    }

    // El token NO se manda al navegador: es la llave del Drive y las hojas de
    // toda la agencia, y una página con él queda en el historial, capturas y
    // cachés. Se escribe en el log del servidor, que solo ve quien opera.
    console.log('[oauth-setup] GOOGLE_OAUTH_REFRESH_TOKEN obtenido. Cópialo del log a EasyPanel:');
    console.log(`[oauth-setup] ${tokens.refresh_token}`);
    res.type('html').send(page('Refresh token obtenido',
      `<h1 class="ok">Refresh token obtenido ✓</h1>
       <p>Por seguridad el token no se muestra aquí: quedó impreso en el <strong>log del servidor</strong>
       (EasyPanel → Service → Logs, búscalo como <code>[oauth-setup]</code>).</p>
       <ol>
         <li>Copia el token desde el log.</li>
         <li>Pégalo en <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> (Service → Environment).</li>
         <li>Redespliega el servicio para que tome la variable.</li>
       </ol>`));
  } catch (e) {
    res.status(500).type('html').send(page('Error al obtener el token',
      `<h1 class="err">No se pudo intercambiar el código</h1><p>${esc((e as Error).message)}</p>
       <p><a class="btn" href="/api/oauth/google/start">Reintentar</a></p>`));
  }
});

export default router;
