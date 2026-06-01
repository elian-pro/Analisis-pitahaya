import { google } from 'googleapis';
import type { JWT } from 'google-auth-library';
import { getGoogleServiceAccount } from '../config/env';

let _client: JWT | null = null;

export function getAuth(): JWT {
  if (!_client) {
    const sa = getGoogleServiceAccount() as {
      client_email: string;
      private_key: string;
    };
    _client = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive',
      ],
    });
  }
  return _client;
}
