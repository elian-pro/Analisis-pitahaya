import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import {
  ClaudeRadarOutputSchema,
  type ClaudeRadarOutput,
  type RadarReportData,
} from '../schemas/radar';
import type { RadarSidecar } from '../radar/sidecar';
import { NO_DASH_INSTRUCTION, DEFAULT_RADAR_PROMPT, resolveRadarPrompt } from './prompts';
export { DEFAULT_RADAR_PROMPT, resolveRadarPrompt };
import { reconcileTaxonomy, computeComparativo, type Remap } from '../radar/compare';

const MAX_RETRIES = 3;
const MODEL       = 'claude-sonnet-4-6';
// El Radar produce output largo (hasta 18 preguntas con evaluación + patrones +
// comparativo), por eso un tope más alto que los demás reportes.
const MAX_TOKENS  = 16384;


let _claude: Anthropic | null = null;
function getClaude(): Anthropic {
  if (!_claude) _claude = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _claude;
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
