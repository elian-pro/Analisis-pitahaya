import { z } from 'zod';
import type { FetchLike } from './transcribe';

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de la llamada con gpt-4o-mini, el mismo modelo que usa n8n hoy,
// para que la salida sea comparable 1:1 al validar la migración.
//
// Por HTTP, sin el SDK `openai`: el patrón de fetch ya está montado y probado
// para Gemini, la llamada son 15 líneas, y añadir el SDK volvería este módulo
// dependiente de credenciales en tiempo de importación. Igual que en
// transcribe.ts, la key entra por parámetro.
//
// Lo único que se añade sobre n8n es la validación con zod: `jsonOutput` obliga
// a que la respuesta sea JSON, pero no a que tenga los campos correctos. Hoy, si
// el modelo devuelve un JSON con otra forma, esa basura acaba escrita en el
// Sheet sin que nadie se entere.
// ─────────────────────────────────────────────────────────────────────────────

export const ANALYSIS_MODEL = 'gpt-4o-mini';

export const AnalysisSchema = z.object({
  TIPO_CONTACTO:   z.string(),
  PRESENTACION:    z.string(),
  PRECALIFICACION: z.string(),
  EXPLORACION:     z.string(),
  AGENDAMIENTO:    z.string(),
  RESUMEN:         z.string(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * n8n aplana el RESUMEN con dos `.replace()` antes de escribirlo, porque una
 * celda de Sheets con saltos de línea rompe la lectura por rangos. En Postgres
 * eso ya no hace falta, pero el texto se sigue normalizando para que el análisis
 * viejo y el nuevo se puedan comparar carácter a carácter durante la migración.
 */
export const aplanar = (s: string): string => s.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();

export async function analyzeTranscript(
  transcripcion: string,
  systemPrompt:  string,
  apiKey:        string,
  fetchFn:       FetchLike = globalThis.fetch,
): Promise<Analysis> {
  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:           ANALYSIS_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: transcripcion },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI devolvió una respuesta sin contenido');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`OpenAI no devolvió JSON válido: ${content.slice(0, 200)}`);
  }

  const result = AnalysisSchema.safeParse(parsed);
  if (!result.success) {
    const faltan = result.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`El análisis no tiene la forma esperada (campos: ${faltan})`);
  }

  return { ...result.data, RESUMEN: aplanar(result.data.RESUMEN) };
}
