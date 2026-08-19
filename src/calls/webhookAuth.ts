import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Autenticación del webhook.
//
// El resto de la API se protege con la cookie de sesión de Google, que no sirve
// para una llamada máquina-a-máquina. Y el repo no tenía ningún mecanismo de
// token ni de firma, así que aquí va el más simple que es correcto: un secreto
// compartido, comparado en tiempo constante.
//
// Se compara el SHA-256 de cada valor y no los valores en crudo, porque
// timingSafeEqual exige buffers del mismo largo y lanza si difieren — con lo que
// la propia excepción filtraría la longitud del secreto.
// ─────────────────────────────────────────────────────────────────────────────

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest();

export function tokensMatch(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

/**
 * `expected` sin configurar devuelve 503, no 401: no es que la petición esté mal
 * autenticada, es que el servidor no está configurado para aceptarla. Confundir
 * ambos casos hace imposible diagnosticar por qué Callpicker recibe rechazos.
 */
export function checkWebhookToken(
  provided: string | undefined | null,
  expected: string | undefined | null,
): AuthResult {
  if (!expected) {
    return { ok: false, status: 503, error: 'El webhook no está configurado (falta CALLS_WEBHOOK_TOKEN).' };
  }
  if (!provided) {
    return { ok: false, status: 401, error: 'Falta el token del webhook.' };
  }
  if (!tokensMatch(provided, expected)) {
    return { ok: false, status: 401, error: 'Token del webhook inválido.' };
  }
  return { ok: true };
}

/** Acepta el token por cabecera o por query, según lo que permita configurar el proveedor. */
export function extractToken(headers: Record<string, unknown>, query: Record<string, unknown>): string | undefined {
  const h = headers['x-webhook-token'];
  if (typeof h === 'string' && h) return h;
  const q = query.token;
  return typeof q === 'string' && q ? q : undefined;
}
