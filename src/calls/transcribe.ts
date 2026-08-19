// ─────────────────────────────────────────────────────────────────────────────
// Transcripción del audio con Gemini, por HTTP directo.
//
// Sin SDK: son ~30 líneas de fetch y el SDK no aporta nada que no sea azúcar.
//
// El audio se manda INLINE en base64, no por URL: `file_data.file_uri` solo
// acepta URIs de la Files API de Gemini o de YouTube, no una URL cualquiera. La
// grabación de Callpicker es pública (200, audio/mpeg) pero hay que descargarla
// nosotros igual. Como referencia, 41 s de llamada pesan 40 KB.
//
// La API key entra por parámetro en vez de importarse de config/env: ese módulo
// hace process.exit(1) al cargarse si falta cualquier variable requerida, lo que
// dejaría este archivo sin poder verificarse fuera de un entorno completo. Mismo
// motivo que documenta advisors/match.ts. Quien resuelve la key es el pipeline.
// ─────────────────────────────────────────────────────────────────────────────

export const GEMINI_MODEL = 'gemini-3.5-flash';

/** Tope defensivo antes de codificar a base64 (que infla ~33%). */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/** Respuesta exacta que el prompt pide cuando el audio no es una conversación. */
export const BUZON = 'buzón de voz';

export type FetchLike = typeof globalThis.fetch;

export interface TranscribeResult {
  /** Texto crudo devuelto por el modelo. */
  text:    string;
  /** true si el modelo lo clasificó como buzón/contestadora. */
  esBuzon: boolean;
}

/**
 * Detecta el buzón como lo hace n8n pero sin sus dos versiones incompatibles:
 * el flujo de Midstorage usa regex `buz[oó]n de voz` y el de Sofía compara con
 * igualdad exacta contra "Buzón de voz" con mayúscula — y su propio prompt pide
 * minúscula, así que necesitó una tercera rama en el Switch para compensar.
 * Aquí una sola regla, insensible a mayúsculas y a la tilde.
 */
export function esBuzonDeVoz(text: string): boolean {
  return /^\s*["']?\s*buz[oó]n de voz\s*["']?\s*\.?\s*$/i.test(text);
}

export async function downloadAudio(
  url:   string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`No se pudo descargar la grabación (HTTP ${res.status})`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('La grabación está vacía');
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `La grabación pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB, ` +
      `por encima del límite de ${MAX_AUDIO_BYTES / 1024 / 1024} MB`,
    );
  }
  return {
    base64:   buf.toString('base64'),
    mimeType: res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg',
  };
}

export async function transcribeAudio(
  recordUrl: string,
  prompt:    string,
  apiKey:    string,
  fetchFn:   FetchLike = globalThis.fetch,
): Promise<TranscribeResult> {
  const { base64, mimeType } = await downloadAudio(recordUrl, fetchFn);

  const res = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }],
        }],
      }),
    },
  );

  if (!res.ok) {
    // El cuerpo trae el motivo real (cuota, clave inválida, audio no soportado);
    // sin él, humanizeError solo vería un número.
    throw new Error(`Gemini respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini devolvió una respuesta sin texto');

  return { text, esBuzon: esBuzonDeVoz(text) };
}
