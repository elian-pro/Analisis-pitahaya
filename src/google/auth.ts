import { google } from 'googleapis';
import type { JWT, OAuth2Client } from 'google-auth-library';
import { getGoogleServiceAccount, getGoogleOAuth } from '../config/env';

// Scopes que necesita la cuenta central para leer hojas y escribir en Drive.
// Deben coincidir con los que se conceden en `npm run oauth:setup`.
export const SHEETS_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive',
];

let _client: OAuth2Client | null = null;

// Acceso a Sheets/Drive con OAuth de la cuenta central (agencia). El OAuth2Client
// refresca el access token automáticamente usando el refresh_token cada vez que
// una llamada lo necesita, así que basta construirlo una vez.
export function getAuth(): OAuth2Client {
  if (!_client) {
    const { clientId, clientSecret, refreshToken } = getGoogleOAuth();
    _client = new google.auth.OAuth2({ clientId, clientSecret });
    _client.setCredentials({ refresh_token: refreshToken });
  }
  return _client;
}

let _chatClient: JWT | null = null;

export function getChatAuth(): JWT {
  if (!_chatClient) {
    const sa = getGoogleServiceAccount() as {
      client_email: string;
      private_key: string;
    };
    _chatClient = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
  }
  return _chatClient;
}
