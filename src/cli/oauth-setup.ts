/**
 * Setup de una sola vez: obtiene el refresh_token de la cuenta central (agencia)
 * para que la app acceda a Google Sheets/Drive por OAuth (en vez de la service
 * account).
 *
 *   npm run oauth:setup
 *
 * Requiere GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en el .env (el
 * mismo cliente OAuth "Aplicación web" que usa el login). Antes de correrlo,
 * agrega esta URI de redirección autorizada en Google Cloud Console → APIs y
 * servicios → Credenciales → (tu cliente OAuth):
 *
 *   http://localhost:53682/oauth2callback
 *
 * El script abre el navegador, inicias sesión con la CUENTA CENTRAL, aceptas los
 * permisos, y al final imprime el GOOGLE_OAUTH_REFRESH_TOKEN para pegar en .env.
 *
 * Nota Workspace: configura la pantalla de consentimiento como "Interna" para que
 * el refresh token no expire (en modo "Testing" caduca a los 7 días).
 */
import http from 'http';
import { exec } from 'child_process';
import { google } from 'googleapis';
import { SHEETS_DRIVE_SCOPES } from '../google/auth';

const PORT = Number(process.env.OAUTH_SETUP_PORT ?? 53682);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const clientId     = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim();

if (!clientId)     fail('Falta GOOGLE_OAUTH_CLIENT_ID en el .env');
if (!clientSecret) fail('Falta GOOGLE_OAUTH_CLIENT_SECRET en el .env');

const oauth2 = new google.auth.OAuth2({
  clientId,
  clientSecret,
  redirectUri: REDIRECT_URI,
});

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',   // pide refresh_token
  prompt: 'consent',        // fuerza que devuelva refresh_token aunque ya haya consentido antes
  scope: SHEETS_DRIVE_SCOPES,
});

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start ""'
            : 'xdg-open';
  exec(`${cmd} "${url}"`, err => {
    if (err) console.log('(No se pudo abrir el navegador automáticamente; usa el enlace de arriba.)');
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end('Not found');
    return;
  }

  const url   = new URL(req.url, REDIRECT_URI);
  const error = url.searchParams.get('error');
  const code  = url.searchParams.get('code');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
       .end(`<h1>Error de autorización: ${error}</h1><p>Puedes cerrar esta pestaña.</p>`);
    server.close();
    fail(`Google devolvió un error de autorización: ${error}`);
  }

  if (!code) {
    res.writeHead(400).end('Falta el parámetro "code".');
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
       .end('<h1>Listo ✓</h1><p>Refresh token obtenido. Vuelve a la terminal. Puedes cerrar esta pestaña.</p>');
    server.close();

    if (!tokens.refresh_token) {
      fail(
        'Google no devolvió refresh_token. Suele pasar si esta cuenta ya había ' +
        'autorizado la app. Revoca el acceso en https://myaccount.google.com/permissions ' +
        'y vuelve a correr `npm run oauth:setup`.',
      );
    }

    console.log('\n✅ Refresh token obtenido. Agrégalo a tu .env:\n');
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('Recuerda que GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET también deben estar en el .env.\n');
    process.exit(0);
  } catch (e) {
    res.writeHead(500).end('Error al intercambiar el código. Revisa la terminal.');
    server.close();
    fail(`No se pudo intercambiar el código por tokens: ${(e as Error).message}`);
  }
});

server.listen(PORT, () => {
  console.log('\n── Setup OAuth de la cuenta central (Sheets/Drive) ──\n');
  console.log(`Escuchando el callback en ${REDIRECT_URI}`);
  console.log('(Asegúrate de haber registrado esa URI en el cliente OAuth de Google Cloud.)\n');
  console.log('Abre este enlace e inicia sesión con la CUENTA CENTRAL de la agencia:\n');
  console.log(`  ${authUrl}\n`);
  openBrowser(authUrl);
});
