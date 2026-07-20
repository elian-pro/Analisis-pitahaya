import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import {
  ClaudeRadarOutputSchema,
  type ClaudeRadarOutput,
  type RadarReportData,
} from '../schemas/radar';
import type { RadarSidecar } from '../radar/sidecar';
import { reconcileTaxonomy, computeComparativo, type Remap } from '../radar/compare';

const MAX_RETRIES = 3;
const MODEL       = 'claude-sonnet-4-6';
// El Radar produce output largo (hasta 18 preguntas con evaluación + patrones +
// comparativo), por eso un tope más alto que los demás reportes.
const MAX_TOKENS  = 16384;

const NO_DASH_INSTRUCTION =
  '\n\nIMPORTANTE: No uses em dashes (—), en dashes (–) ni guiones largos en ningún texto generado. ' +
  'Usa dos puntos, comas, paréntesis o punto según corresponda gramaticalmente. ' +
  'Escribe siempre en español correcto: incluye todas las tildes (á, é, í, ó, ú, ü), la ñ y demás signos diacríticos. ' +
  'Nunca omitas acentos ni la ñ.';

let _claude: Anthropic | null = null;
function getClaude(): Anthropic {
  if (!_claude) _claude = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _claude;
}

// ── Prompt por defecto (valor de `prompt_radar` cuando el cliente no lo define) ─
// Pensado para un reporte que se COMPARTE con el cliente final: evaluación a
// nivel de equipo (agregada, sin nombrar asesores), tono profesional y directo.
export const DEFAULT_RADAR_PROMPT = `Eres un analista senior de ventas. Analizas transcripciones de llamadas de prospeccion de un periodo y produces el reporte "Radar de Objeciones": que preguntan los prospectos, como responde el equipo comercial y que patrones hay detras.

CONTEXTO DEL NEGOCIO
{contexto}

REGLAS DE EXTRACCION DE PREGUNTAS
1. Una "pregunta frecuente" es una duda o solicitud del PROSPECTO (nunca del asesor), agrupada por intencion semantica aunque el fraseo varie.
2. Incluye toda pregunta que aparezca en 2 o mas llamadas distintas, hasta un maximo de 18. Si menos de 8 superan el umbral, completa con las de una sola aparicion marcandolas con frecuencia 1.
3. Cada pregunta lleva un categoria_id en slug (minusculas, sin acentos, guiones). Si recibes la taxonomia del periodo anterior, REUTILIZA el slug existente cuando la intencion sea la misma; crea slugs nuevos solo para preguntas realmente nuevas. Nunca renombres un slug existente.
4. Registra los indices de las llamadas donde aparece cada pregunta. La frecuencia debe coincidir con la cantidad de indices. No inventes: si no esta en las transcripciones, no existe.

REGLAS DE EVALUACION DE RESPUESTAS
5. Para cada pregunta describe la respuesta tipica del equipo (patron real observado, no el ideal) y evaluala: bien | mejorable | critico.
   - bien: respuesta consistente que avanza hacia el objetivo de la llamada.
   - mejorable: funciona pero pierde oportunidades o es inconsistente.
   - critico: la respuesta rompe conversaciones o pierde leads con intencion.
6. Acompana cada evaluacion con una observacion accionable de 1 a 3 frases y, cuando exista, una cita textual corta (maximo 15 palabras) con el indice de la llamada de donde salio.

PATRONES Y RECOMENDACIONES
7. Identifica patrones de los prospectos (perfil, objeciones dominantes, comportamientos repetidos) y del equipo (fortalezas y areas de mejora), cada uno con evidencia (indices de llamadas). Habla del equipo de forma agregada; no menciones a asesores por su nombre.
8. Si recibes el resumen del periodo anterior, dedica el analisis comparativo a explicar POR QUE cambiaron las frecuencias y evaluaciones, y si las recomendaciones anteriores se implementaron. No recalcules los deltas: se te entregan calculados.
9. Cierra con maximo 6 recomendaciones priorizadas (alta | media | baja), concretas y ejecutables por el equipo comercial.

ESTILO
Espanol correcto con tildes y enes. Tono directo y profesional, sin adornos. Es un reporte que se comparte con el dueno del negocio: cada hallazgo debe responder "y esto que hago con ello". No expongas nombres de asesores individuales.`;

// Inserta el contexto de negocio en el prompt (default o el del cliente si trae
// el placeholder {contexto}). Si el prompt del cliente no tiene placeholder, se
// respeta tal cual (el contexto ya vive dentro de su prompt).
export function resolveRadarPrompt(clientPrompt: string | null | undefined, contexto?: string): string {
  const base = (clientPrompt && clientPrompt.trim()) ? clientPrompt : DEFAULT_RADAR_PROMPT;
  const ctx  = (contexto && contexto.trim()) ? contexto.trim() : 'No se proporciono contexto adicional del negocio.';
  return base.includes('{contexto}') ? base.replace('{contexto}', ctx) : base;
}

// ── Entradas del análisis ─────────────────────────────────────────────────────
export interface RadarCall {
  index:          number;   // 1-based, posición en la lista LLAMADAS
  fecha:          string;
  asesor:         string;
  duracion_label?: string;  // "6:12" (solo para mostrar)
  transcripcion:  string;
}

export interface RadarPeriodMeta {
  client_name:    string;
  period_label:   string;   // "Junio 2026"
  period_key:     string;   // "YYYY-MM"
  date_from:      string;
  date_to:        string;
  total_calls:    number;
  analyzed_calls: number;
  excluded_calls: number;
  source:         'database' | 'markdown_upload';
}

// ── User message (mismo formato para el flujo DB y el flujo .md) ──────────────
export function buildUserMessage(
  meta:  RadarPeriodMeta,
  calls: RadarCall[],
  prev:  RadarSidecar | null,
): string {
  const parts: string[] = [];
  parts.push(`PERIODO: ${meta.period_label} (${meta.date_from} a ${meta.date_to})`);
  parts.push(`TOTAL DE LLAMADAS ANALIZADAS: ${meta.analyzed_calls} (de ${meta.total_calls} en la fuente; ${meta.excluded_calls} excluidas)`);

  if (prev && prev.questions.length > 0) {
    parts.push('');
    parts.push('TAXONOMIA DEL PERIODO ANTERIOR (reutiliza estos categoria_id cuando la intencion sea la misma):');
    for (const q of prev.questions) {
      parts.push(`- ${q.categoria_id}: "${q.pregunta_canonica}" (frecuencia ${q.frecuencia}, evaluacion ${q.evaluacion})`);
    }
    if (prev.executive_summary) {
      parts.push('');
      parts.push('RESUMEN DEL PERIODO ANTERIOR:');
      parts.push(prev.executive_summary);
    }
    if (prev.recomendaciones.length > 0) {
      parts.push('');
      parts.push('RECOMENDACIONES DEL PERIODO ANTERIOR (evalua si se implementaron):');
      for (const r of prev.recomendaciones) parts.push(`- [${r.prioridad}] ${r.titulo}: ${r.descripcion}`);
    }
  }

  parts.push('');
  parts.push('LLAMADAS:');
  for (const c of calls) {
    const dur = c.duracion_label ? ` | Duracion: ${c.duracion_label}` : '';
    parts.push(`[${c.index}] Fecha: ${c.fecha} | Asesor: ${c.asesor}${dur}`);
    parts.push(c.transcripcion);
    parts.push('---');
  }
  parts.push('');
  parts.push('Analiza las llamadas y entrega el reporte con la herramienta. Los indices en "llamadas" deben referirse al numero [n] de cada llamada de la lista.');
  return parts.join('\n');
}

// ── Definición de la herramienta (replica el zod) ─────────────────────────────
const TOOL_NAME = 'entregar_reporte_radar';

const RADAR_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Entrega el reporte estructurado "Radar de Objeciones".',
  input_schema: {
    type: 'object',
    required: ['executive_summary', 'preguntas', 'patrones_prospectos', 'patrones_equipo', 'recomendaciones'],
    properties: {
      executive_summary: { type: 'string' },
      preguntas: {
        type: 'array',
        description: 'Entre 5 y 18 preguntas frecuentes del prospecto, ordenadas por frecuencia descendente.',
        items: {
          type: 'object',
          required: ['categoria_id', 'pregunta_canonica', 'frecuencia', 'llamadas', 'respuesta_tipica', 'evaluacion', 'observacion'],
          properties: {
            categoria_id:      { type: 'string', description: 'slug estable: minusculas, sin acentos, guiones. Reutiliza el del periodo anterior si aplica.' },
            pregunta_canonica: { type: 'string' },
            frecuencia:        { type: 'integer', description: 'Debe ser igual a la cantidad de indices en "llamadas".' },
            llamadas:          { type: 'array', items: { type: 'integer' }, description: 'Indices [n] de las llamadas donde aparece.' },
            respuesta_tipica:  { type: 'string' },
            evaluacion:        { type: 'string', enum: ['bien', 'mejorable', 'critico'] },
            observacion:       { type: 'string' },
            cita:              { type: 'string', description: 'Cita textual corta (max 15 palabras).' },
          },
        },
      },
      patrones_prospectos: {
        type: 'array',
        items: {
          type: 'object',
          required: ['titulo', 'descripcion', 'llamadas'],
          properties: {
            titulo:      { type: 'string' },
            descripcion: { type: 'string' },
            llamadas:    { type: 'array', items: { type: 'integer' } },
          },
        },
      },
      patrones_equipo: {
        type: 'object',
        required: ['fortalezas', 'areas_mejora'],
        properties: {
          fortalezas: {
            type: 'array',
            items: { type: 'object', required: ['titulo', 'descripcion'], properties: { titulo: { type: 'string' }, descripcion: { type: 'string' } } },
          },
          areas_mejora: {
            type: 'array',
            items: { type: 'object', required: ['titulo', 'descripcion'], properties: { titulo: { type: 'string' }, descripcion: { type: 'string' } } },
          },
        },
      },
      analisis_comparativo: { type: 'string', description: 'Solo si se entrega un periodo anterior. Explica el porque de los cambios.' },
      recomendaciones: {
        type: 'array',
        description: 'Maximo 6, priorizadas.',
        items: {
          type: 'object',
          required: ['prioridad', 'titulo', 'descripcion'],
          properties: {
            prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
            titulo:      { type: 'string' },
            descripcion: { type: 'string' },
          },
        },
      },
    },
  },
};

// ── Validación extra tras zod (ataca la alucinación de frecuencias) ───────────
// Cada pregunta: frecuencia === nº de índices, y todos los índices dentro de rango.
export function validateFrequencies(out: ClaudeRadarOutput, callCount: number): string | null {
  for (const q of out.preguntas) {
    if (q.frecuencia !== q.llamadas.length) {
      return `La pregunta '${q.categoria_id}' declara frecuencia ${q.frecuencia} pero trae ${q.llamadas.length} indices.`;
    }
    for (const idx of q.llamadas) {
      if (idx < 1 || idx > callCount) {
        return `La pregunta '${q.categoria_id}' referencia la llamada ${idx}, fuera de rango (1..${callCount}).`;
      }
    }
  }
  return null;
}

interface RadarCallResult {
  data:          ClaudeRadarOutput;
  input_tokens:  number;
  output_tokens: number;
}

async function callClaudeWithRetry(
  systemPrompt: string,
  userMessage:  string,
  callCount:    number,
): Promise<RadarCallResult> {
  let lastError: Error = new Error('No attempts made');
  let totalInput = 0, totalOutput = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await getClaude().messages.create({
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt + NO_DASH_INSTRUCTION,
        messages:   [{ role: 'user', content: userMessage }],
        tools:      [RADAR_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });
      totalInput  += res.usage.input_tokens;
      totalOutput += res.usage.output_tokens;

      const toolBlock = res.content.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Claude response contained no tool_use block');
      }
      const parsed = ClaudeRadarOutputSchema.safeParse(toolBlock.input);
      if (!parsed.success) {
        throw new Error(`Zod validation failed (attempt ${attempt}): ${parsed.error.message}`);
      }
      const freqError = validateFrequencies(parsed.data, callCount);
      if (freqError) {
        throw new Error(`Frecuencias inconsistentes (attempt ${attempt}): ${freqError}`);
      }
      return { data: parsed.data, input_tokens: totalInput, output_tokens: totalOutput };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        console.warn(`[claude/radar] Attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);
      }
    }
  }
  throw lastError;
}

// ── Ensamblado determinista del reporte (testeable sin llamar a Claude) ───────
// Aplica la reconciliación de taxonomía (fuzzy) y calcula el comparativo.
export function buildRadarReportData(
  claudeOut: ClaudeRadarOutput,
  meta:      RadarPeriodMeta,
  prev:      RadarSidecar | null,
  now:       Date = new Date(),
): { reportData: RadarReportData; remaps: Remap[] } {
  const { reconciled, remaps } = reconcileTaxonomy(claudeOut, prev);
  const comparativo = prev ? computeComparativo(reconciled, prev) : undefined;

  const generated_date = [
    String(now.getDate()).padStart(2, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    now.getFullYear(),
  ].join('/');

  const reportData: RadarReportData = {
    ...reconciled,
    client_name:     meta.client_name,
    period_label:    meta.period_label,
    period_key:      meta.period_key,
    date_from:       meta.date_from,
    date_to:         meta.date_to,
    generated_date,
    total_calls:     meta.total_calls,
    analyzed_calls:  meta.analyzed_calls,
    excluded_calls:  meta.excluded_calls,
    is_first_period: !prev,
    source:          meta.source,
    comparativo,
  };
  return { reportData, remaps };
}

// ── Análisis completo: Claude + ensamblado. (El PDF y la subida son puntos 2/4.) ─
export interface AnalyzeRadarResult {
  reportData:    RadarReportData;
  remaps:        Remap[];
  input_tokens:  number;
  output_tokens: number;
}

export async function analyzeRadar(
  systemPrompt: string,
  meta:         RadarPeriodMeta,
  calls:        RadarCall[],
  prev:         RadarSidecar | null,
): Promise<AnalyzeRadarResult> {
  if (calls.length === 0) throw new Error('No hay llamadas para analizar en el periodo.');
  const userMessage = buildUserMessage(meta, calls, prev);
  const { data, input_tokens, output_tokens } = await callClaudeWithRetry(systemPrompt, userMessage, calls.length);
  const { reportData, remaps } = buildRadarReportData(data, meta, prev);
  if (remaps.length > 0) {
    console.log(`[claude/radar] Reconciliacion de taxonomia: ${remaps.map(r => `${r.from}->${r.to}(${r.score})`).join(', ')}`);
  }
  return { reportData, remaps, input_tokens, output_tokens };
}
