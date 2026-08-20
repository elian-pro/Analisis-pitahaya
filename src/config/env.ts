import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Solo se usa para Google Chat (getChatAuth). El acceso a Sheets/Drive migró a
  // OAuth de usuario (cuenta central), ver getGoogleOAuth() más abajo.
  GOOGLE_SA_JSON: z.string().min(1, 'GOOGLE_SA_JSON is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  PORT: z.coerce.number().int().positive().default(3000),

  // OAuth de la cuenta central (agencia) para Sheets/Drive. El CLIENT_ID es el
  // mismo que usa el login. Opcionales en el schema para que `oauth:setup` pueda
  // correr y GENERAR el refresh token; getGoogleOAuth() valida en tiempo de uso.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),

  // URL pública de la app (p. ej. https://mi-app.dominio.cloud). Se usa para
  // construir el redirect_uri del flujo de setup OAuth in-app. Si se deja vacía
  // se deriva de las cabeceras del proxy (X-Forwarded-Proto + Host).
  APP_BASE_URL: z.string().optional(),

  // ── Pipeline de llamadas (lee de la base de Callpicker, transcribe, analiza) ─
  // CALLS_DATABASE_URL no se valida aquí: se lee con process.env en calls/db.ts,
  // igual que DATABASE_URL en config/db.ts.
  // Todas opcionales a propósito: el pipeline nace apagado y la app tiene que
  // poder arrancar sin ninguna de ellas. Se validan en tiempo de uso con los
  // getters de más abajo, igual que las de OAuth.
  CALLS_PIPELINE:      z.enum(['on', 'off']).default('off'),
  GEMINI_API_KEY:      z.string().optional(),
  OPENAI_API_KEY:      z.string().optional(),

  // ── ZCIS: el panel donde vive la oferta de cada cliente ─────────────────────
  // Opcionales: sin la llave la app arranca igual y el botón de importar no
  // aparece; el contexto de negocio se escribe a mano, que es como funciona hoy
  // para cuatro de los cinco clientes.
  ZCIS_BASE_URL:       z.string().optional(),
  ZCIS_API_KEY:        z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Missing required environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export function getGoogleServiceAccount(): object {
  try {
    return JSON.parse(env.GOOGLE_SA_JSON);
  } catch {
    console.error('❌ GOOGLE_SA_JSON is not valid JSON');
    process.exit(1);
  }
}

export interface GoogleOAuthCredentials {
  clientId:     string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Credenciales del cliente OAuth (id + secret), SIN el refresh token. Las usa el
 * flujo de setup (in-app o CLI), que justamente sirve para GENERAR el refresh
 * token que aún falta.
 */
export function getGoogleOAuthAppCreds(): { clientId: string; clientSecret: string } {
  const clientId     = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;

  const missing = [
    !clientId     && 'GOOGLE_OAUTH_CLIENT_ID',
    !clientSecret && 'GOOGLE_OAUTH_CLIENT_SECRET',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Faltan variables del cliente OAuth: ${missing.join(', ')}.`);
  }
  return { clientId: clientId!, clientSecret: clientSecret! };
}

/**
 * Credenciales OAuth completas de la cuenta central para acceder a Sheets/Drive.
 * Valida en tiempo de uso (no al arrancar) para que el setup pueda correr con
 * solo CLIENT_ID/SECRET y generar el refresh token que falta.
 */
// ── Pipeline de llamadas ─────────────────────────────────────────────────────

/**
 * Apagado, el barrido automático no arranca. La lectura y el procesamiento
 * manual de una llamada sí funcionan: así se puede recorrer el pipeline entero,
 * llamada a llamada, antes de dejar que corra solo.
 */
export const callsPipelineEnabled = (): boolean => env.CALLS_PIPELINE === 'on';

export function getGeminiKey(): string {
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      'Falta GEMINI_API_KEY para transcribir el audio. Consíguela en https://aistudio.google.com/apikey',
    );
  }
  return env.GEMINI_API_KEY;
}

export function getOpenAIKey(): string {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      'Falta OPENAI_API_KEY para analizar la transcripción. Consíguela en https://platform.openai.com/api-keys',
    );
  }
  return env.OPENAI_API_KEY;
}

// ── ZCIS ─────────────────────────────────────────────────────────────────────

/** Sin llave no hay integración: la fila de importar ni siquiera se muestra. */
export const zcisEnabled = (): boolean => Boolean(env.ZCIS_API_KEY);

export function getZcis(): { base: string; key: string } {
  if (!env.ZCIS_API_KEY) {
    throw new Error('Falta ZCIS_API_KEY para leer la oferta del cliente desde ZCIS.');
  }
  return {
    base: env.ZCIS_BASE_URL || 'https://panel.zebra-ecosystem.cloud',
    key:  env.ZCIS_API_KEY,
  };
}

export function getGoogleOAuth(): GoogleOAuthCredentials {
  const { clientId, clientSecret } = getGoogleOAuthAppCreds();
  const refreshToken = env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error(
      `Falta GOOGLE_OAUTH_REFRESH_TOKEN para acceder a Sheets/Drive. ` +
      `Autoriza la cuenta central en /api/oauth/google/start (o ejecuta \`npm run oauth:setup\`).`,
    );
  }

  return { clientId, clientSecret, refreshToken };
}
