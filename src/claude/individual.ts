import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import {
  ClaudeIndividualOutputSchema,
  type ClaudeIndividualOutput,
  type IndividualReportData,
} from '../schemas/individual';
import type { CallRow } from '../google/sheets';
import { renderPdf } from '../pdf/renderer';
import { monthLabel } from '../google/drive';

interface ClientForAnalysis {
  prompt_individual: string;
}

export interface PreviousMetrics {
  avg_score:                number;
  pct_logra_siguiente_paso: number;
  talk_ratio:               number;
}

const MAX_RETRIES = 3;
const MODEL       = 'claude-sonnet-4-6';

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

// ── Deterministic metrics ─────────────────────────────────────────────────────

function computeMetrics(calls: CallRow[]) {
  const scores = calls
    .map(c => parseFloat(c.calif))
    .filter(s => !isNaN(s) && isFinite(s));

  if (scores.length === 0) {
    return { call_count: calls.length, avg_score: 0, score_min: 0, score_max: 0, score_sigma: 0 };
  }

  const avg   = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min   = Math.min(...scores);
  const max   = Math.max(...scores);
  const sigma = Math.sqrt(scores.reduce((s, v) => s + (v - avg) ** 2, 0) / scores.length);

  return {
    call_count:  calls.length,
    avg_score:   Math.round(avg),
    score_min:   Math.round(min),
    score_max:   Math.round(max),
    score_sigma: Math.round(sigma),
  };
}

// ── Sidecar parsing ───────────────────────────────────────────────────────────

export function parseSidecarMetrics(text: string): PreviousMetrics | null {
  const match = text.match(/=== METRICAS_JSON ===\n(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (
      typeof parsed.avg_score === 'number' &&
      typeof parsed.pct_logra_siguiente_paso === 'number' &&
      typeof parsed.talk_ratio === 'number'
    ) {
      return {
        avg_score:                parsed.avg_score,
        pct_logra_siguiente_paso: parsed.pct_logra_siguiente_paso,
        talk_ratio:               parsed.talk_ratio,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Prompt construction ───────────────────────────────────────────────────────

function formatCalls(calls: CallRow[]): string {
  return calls.map((c, i) => {
    const parts = [`--- Llamada ${i + 1} | Fecha: ${c.fecha} | Calificacion: ${c.calif} ---`];
    if (c.analisis) parts.push(`ANALISIS PREVIO:\n${c.analisis}`);
    parts.push(`TRANSCRIPCION:\n${c.transcripcion}`);
    return parts.join('\n');
  }).join('\n\n');
}

function buildUserMessage(
  advisorName:   string,
  calls:         CallRow[],
  month:         string,
  previousReport: string | null,
  prevMetrics:   PreviousMetrics | null,
): string {
  const deltaNote = prevMetrics
    ? [
        ``,
        `=== COMPARATIVO PERIODO ANTERIOR ===`,
        `Score anterior: ${prevMetrics.avg_score}/100 | Sig. paso anterior: ${prevMetrics.pct_logra_siguiente_paso}% | Talk ratio anterior: ${prevMetrics.talk_ratio}%`,
      ].join('\n')
    : '';

  return [
    `=== DATOS DEL PERIODO ===`,
    `Asesor: ${advisorName}`,
    `Mes: ${monthLabel(month)}`,
    `Llamadas en el periodo: ${calls.length}`,
    deltaNote,
    ``,
    `=== LLAMADAS ===`,
    formatCalls(calls),
    ``,
    `=== REPORTE PERIODO ANTERIOR ===`,
    previousReport ?? 'Sin reporte previo: primer periodo de evaluacion.',
    ``,
    `Analiza el desempeno de ${advisorName} y genera el reporte estructurado usando la herramienta.`,
  ].join('\n');
}

// ── Tool definition ───────────────────────────────────────────────────────────

const TOOL_NAME = 'enviar_reporte_individual';

const REPORT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Envia el reporte de desempeno estructurado del asesor.',
  input_schema: {
    type: 'object',
    required: [
      'tipo_asesor','nivel','objeciones_por_llamada','tasa_resolucion_global',
      'pct_logra_siguiente_paso','resumen','criterios','elementos_producto',
      'elementos_subutilizados','objeciones','categorias_peor_manejadas','sesgos',
      'sesgos_subutilizados','talk_ratio','preguntas_promedio','cierres',
      'fortalezas','debilidades','mejor_llamada','peor_llamada','recomendaciones',
    ],
    properties: {
      tipo_asesor:              { type: 'string', enum: ['linner','cerrador','desconocido'] },
      nivel:                    { type: 'string', enum: ['excelente','bueno','aceptable','necesita_mejora','critico'] },
      objeciones_por_llamada:   { type: 'number' },
      tasa_resolucion_global:   { type: 'number' },
      pct_logra_siguiente_paso: { type: 'number' },
      resumen:                  { type: 'string' },
      criterios: {
        type: 'array', items: {
          type: 'object', required: ['nombre','puntaje','max_puntaje','porcentaje'],
          properties: { nombre:{type:'string'}, puntaje:{type:'number'}, max_puntaje:{type:'number'}, porcentaje:{type:'number'} },
        },
      },
      elementos_producto: {
        type: 'array', items: {
          type: 'object', required: ['elemento','pct_llamadas'],
          properties: { elemento:{type:'string'}, pct_llamadas:{type:'number'} },
        },
      },
      elementos_subutilizados: { type: 'array', items: { type: 'string' } },
      objeciones: {
        type: 'array', items: {
          type: 'object',
          required: ['categoria','veces','pct_llamadas','tasa_resolucion','tecnicas',
                     'ejemplo_objecion','ejemplo_respuesta_efectiva','ejemplo_respuesta_fallida'],
          properties: {
            categoria:{type:'string'}, veces:{type:'integer'}, pct_llamadas:{type:'number'},
            tasa_resolucion:{type:'number'}, tecnicas:{type:'string'},
            ejemplo_objecion:{type:'string'}, ejemplo_respuesta_efectiva:{type:'string'},
            ejemplo_respuesta_fallida:{type:'string'},
          },
        },
      },
      categorias_peor_manejadas: {
        type: 'array', items: {
          type: 'object', required: ['categoria','consejo'],
          properties: { categoria:{type:'string'}, consejo:{type:'string'} },
        },
      },
      sesgos: {
        type: 'array', items: {
          type: 'object', required: ['nombre','promedio_por_llamada','pct_llamadas'],
          properties: { nombre:{type:'string'}, promedio_por_llamada:{type:'number'}, pct_llamadas:{type:'number'} },
        },
      },
      sesgos_subutilizados: { type: 'array', items: { type: 'string' } },
      talk_ratio:         { type: 'number' },
      preguntas_promedio: { type: 'number' },
      cierres: {
        type: 'object',
        required: ['apartado','cita_seguimiento','firma','fecha_decision','sin_siguiente_paso'],
        properties: {
          apartado:{type:'integer'}, cita_seguimiento:{type:'integer'},
          firma:{type:'integer'}, fecha_decision:{type:'integer'}, sin_siguiente_paso:{type:'integer'},
        },
      },
      fortalezas: {
        type: 'array', items: {
          type: 'object', required: ['descripcion','pct_llamadas'],
          properties: { descripcion:{type:'string'}, pct_llamadas:{type:'number'}, cita:{type:'string'} },
        },
      },
      debilidades: {
        type: 'array', items: {
          type: 'object', required: ['descripcion','pct_llamadas','impacto'],
          properties: {
            descripcion:{type:'string'}, pct_llamadas:{type:'number'},
            impacto:{type:'string', enum:['alta','media','baja']},
          },
        },
      },
      mejor_llamada: {
        type: 'object', required: ['score','fecha','lead','descripcion'],
        properties: { score:{type:'number'}, fecha:{type:'string'}, lead:{type:'string'}, descripcion:{type:'string'} },
      },
      peor_llamada: {
        type: 'object', required: ['score','fecha','lead','descripcion'],
        properties: { score:{type:'number'}, fecha:{type:'string'}, lead:{type:'string'}, descripcion:{type:'string'} },
      },
      recomendaciones: {
        type: 'array', items: {
          type: 'object', required: ['prioridad','area','accion','metrica'],
          properties: {
            prioridad:{type:'string', enum:['alta','media','baja']},
            area:{type:'string'}, accion:{type:'string'}, metrica:{type:'string'},
          },
        },
      },
    },
  },
};

// ── Claude call with retries ──────────────────────────────────────────────────

async function callClaudeWithRetry(
  systemPrompt: string,
  userMessage:  string,
): Promise<ClaudeIndividualOutput> {
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await getClaude().messages.create({
        model:      MODEL,
        max_tokens: 8192,
        system:     systemPrompt + NO_DASH_INSTRUCTION,
        messages:   [{ role: 'user', content: userMessage }],
        tools:      [REPORT_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const toolBlock = res.content.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Claude response contained no tool_use block');
      }

      const parsed = ClaudeIndividualOutputSchema.safeParse(toolBlock.input);
      if (!parsed.success) {
        throw new Error(`Zod validation failed (attempt ${attempt}): ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        console.warn(`[claude/individual] Attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);
      }
    }
  }

  throw lastError;
}

// ── Sidecar text for next-period comparison ───────────────────────────────────

export function buildSidecar(d: IndividualReportData, periodKey: string): string {
  const criterios = d.criterios
    .map(c => `  ${c.nombre}: ${c.puntaje}/${c.max_puntaje} (${c.porcentaje}%)`)
    .join('\n');
  const recs = d.recomendaciones
    .map(r => `  [${r.prioridad}] ${r.area}: ${r.accion}`)
    .join('\n');

  return [
    `REPORTE INDIVIDUAL: ${d.asesor}: ${d.mes_label}${d.period_label ? ` (${d.period_label})` : ''}`,
    `Nivel: ${d.nivel} | Score: ${d.avg_score}/100 (${d.score_min} a ${d.score_max}, sigma=${d.score_sigma})`,
    `Llamadas: ${d.call_count} | Talk ratio: ${d.talk_ratio}% | Sig. paso: ${d.pct_logra_siguiente_paso}%`,
    `Periodo clave: ${periodKey}`,
    ``,
    `RESUMEN:`,
    d.resumen,
    ``,
    `CRITERIOS:`,
    criterios,
    ``,
    `RECOMENDACIONES:`,
    recs,
    ``,
    `=== METRICAS_JSON ===`,
    JSON.stringify({
      avg_score:                d.avg_score,
      pct_logra_siguiente_paso: d.pct_logra_siguiente_paso,
      talk_ratio:               d.talk_ratio,
    }),
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AdvisorResult {
  asesor:     string;
  pdfBuffer:  Buffer;
  reportData: IndividualReportData;
}

export async function processAdvisor(
  advisorName:    string,
  calls:          CallRow[],
  client:         ClientForAnalysis,
  month:          string,
  previousReport: string | null,
  prevMetrics:    PreviousMetrics | null,
  periodLabel?:   string,
): Promise<AdvisorResult> {
  if (calls.length === 0) {
    throw new Error(`No calls found for advisor '${advisorName}' in ${month}`);
  }

  const metrics     = computeMetrics(calls);
  const userMessage = buildUserMessage(advisorName, calls, month, previousReport, prevMetrics);
  const claudeOut   = await callClaudeWithRetry(client.prompt_individual, userMessage);

  const now = new Date();
  const generated_date = [
    String(now.getDate()).padStart(2, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    now.getFullYear(),
  ].join('/');

  const has_previous           = prevMetrics !== null;
  const delta_score            = prevMetrics ? metrics.avg_score - prevMetrics.avg_score : undefined;
  const delta_siguiente_paso   = prevMetrics ? claudeOut.pct_logra_siguiente_paso - prevMetrics.pct_logra_siguiente_paso : undefined;
  const delta_talk_ratio       = prevMetrics ? claudeOut.talk_ratio - prevMetrics.talk_ratio : undefined;

  const reportData: IndividualReportData = {
    ...claudeOut,
    asesor: advisorName,
    mes: month,
    mes_label: monthLabel(month),
    period_label: periodLabel,
    generated_date,
    ...metrics,
    has_previous,
    delta_score,
    delta_siguiente_paso,
    delta_talk_ratio,
  };

  const pdfBuffer = await renderPdf('individual', reportData as unknown as Record<string, unknown>);

  return { asesor: advisorName, pdfBuffer, reportData };
}
