import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Configuración de autenticación con Google.
//
// La autenticación se ACTIVA únicamente cuando GOOGLE_OAUTH_CLIENT_ID está
// definido. Sin esa variable la app corre abierta (como antes), para no dejar
// fuera a nadie por una mala configuración; al definirla, el login con Google
// pasa a ser obligatorio y solo entran los dominios permitidos.
// ─────────────────────────────────────────────────────────────────────────────

function parseDomains(raw: string | undefined): string[] {
  return (raw && raw.trim() ? raw : 'zebradigital.marketing')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
const enabled  = clientId.length > 0;

let sessionSecret = (process.env.AUTH_SESSION_SECRET ?? '').trim();
if (enabled && !sessionSecret) {
  // Sin secreto fijo las sesiones siguen siendo seguras, pero se invalidan en
  // cada reinicio (obliga a volver a iniciar sesión). Define AUTH_SESSION_SECRET
  // para que sobrevivan a los redeploys.
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[auth] AUTH_SESSION_SECRET no definido: usando un secreto aleatorio por arranque ' +
    '(las sesiones se cerraran al reiniciar). Define AUTH_SESSION_SECRET para persistirlas.',
  );
}

export const authConfig = {
  /** true cuando GOOGLE_OAUTH_CLIENT_ID esta definido. */
  enabled,
  /** Client ID del cliente OAuth de Google (web). */
  clientId,
  /** Secreto para firmar la cookie de sesion (HMAC). */
  sessionSecret: sessionSecret || 'auth-disabled',
  /** Dominios de correo permitidos (sin @). Default: zebradigital.marketing. */
  allowedDomains: parseDomains(process.env.ALLOWED_EMAIL_DOMAINS),
  /** La cookie va con Secure salvo que AUTH_COOKIE_INSECURE este definido (solo para pruebas en http local). */
  cookieSecure: !(process.env.AUTH_COOKIE_INSECURE ?? '').trim(),
};

if (enabled) {
  console.log(`[auth] Login con Google ACTIVO. Dominios permitidos: ${authConfig.allowedDomains.map(d => '@' + d).join(', ')}`);
} else {
  console.warn(
    '[auth] GOOGLE_OAUTH_CLIENT_ID no definido: la app corre SIN autenticacion (abierta). ' +
    'Define GOOGLE_OAUTH_CLIENT_ID para exigir login con Google.',
  );
}
