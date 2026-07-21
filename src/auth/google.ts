import { OAuth2Client } from 'google-auth-library';
import { authConfig } from './config';

// Verifica el ID token (JWT) que emite "Sign in with Google" contra los
// certificados públicos de Google y confirma que la audiencia es nuestro
// Client ID. Devuelve la identidad o lanza si el token es inválido.

let _client: OAuth2Client | null = null;
function client(): OAuth2Client {
  if (!_client) _client = new OAuth2Client(authConfig.clientId);
  return _client;
}

export interface GoogleIdentity {
  email:   string;
  name?:   string;
  picture?: string;
  hd?:     string; // hosted domain (Google Workspace)
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const ticket = await client().verifyIdToken({ idToken, audience: authConfig.clientId });
  const p = ticket.getPayload();
  if (!p || !p.email) throw new Error('El token de Google no contiene un correo.');
  if (!p.email_verified) throw new Error('Google no verifico este correo.');
  return { email: p.email.toLowerCase(), name: p.name, picture: p.picture, hd: p.hd };
}

// Solo se permite el acceso a los dominios configurados. Como el correo viene
// de un token verificado por Google, un dominio de Workspace no puede ser
// suplantado por una cuenta personal de Gmail.
export function emailAllowed(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return authConfig.allowedDomains.includes(domain);
}
