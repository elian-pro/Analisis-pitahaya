import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import {
  ClaudeGeneralOutputSchema,
  type ClaudeGeneralOutput,
  type GeneralReportData,
} from '../schemas/general';
import type { AdvisorResult } from './individual';
import { renderPdf } from '../pdf/renderer';
import { monthLabel } from '../google/drive';

interface ClientForGeneral {
  name:          string;
  prompt_general: string;
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

// ── Deterministic team metrics ────────────────────────────────────────────────

function buildRanking(reports: AdvisorResult[]) {
  return [...reports]
    .sort((a, b) => b.reportData.avg_score - a.reportData.avg_score)
    .map((r, i) => ({
      posicion:    i + 1,
      asesor:      r.asesor,
      avg_score:   r.reportData.avg_score,
      score_min:   r.reportData.score_min,
      score_max:   r.reportData.score_max,
      call_count:  r.reportData.call_count,
      nivel:       r.reportData.nivel,
      delta_score: r.reportData.delta_score,
    }));
}

// ── Prompt construction ───────────────────────────────────────────────────────

function summarizeAdvisor(r: AdvisorResult): string {
  const d = r.reportData;
  const criterios = d.criterios
    .map(c => `  ${c.nombre}: ${c.puntaje}/${c.max_puntaje} (${c.porcentaje}%)`)
    .join('\n');
  const debilidades = d.debilidades
    .map(deb => `  - [impacto ${deb.impacto}] ${deb.descripcion}`)
    .join('\n');
  const recs = d.recomendaciones.slice(0, 3)
    .map(rec => `  [${rec.prioridad}] ${rec.area}: ${rec.accion}`)
    .join('\n');

  const deltaNote = d.has_previous && d.delta_score !== undefined
    ? ` | Variacion score: ${d.delta_score >= 0 ? '+' : ''}${d.delta_score} pts vs periodo anterior`
    : ' | Primer periodo de evaluacion';

  return [
    `--- ${d.asesor} | ${d.nivel.toUpperCase()} | ${d.avg_score}/100 | ${d.call_count} llamadas${deltaNote} ---`,
    `Resumen: ${d.resumen}`,
    `Criterios:\n${criterios}`,
    `Debilidades principales:\n${debilidades}`,
    `Top recomendaciones:\n${recs}`,
  ].join('\n');
}

function buildUserMessage(
  reports:        AdvisorResult[],
  clientName:     string,
  month:          string,
  avgScoreEquipo: number,
  totalLlamadas:  number,
  periodLabel?:   string,
): string {
  const summaries = reports.map(summarizeAdvisor).join('\n\n');
  const hasPrevious = reports.some(r => r.reportData.has_previous);

  return [
    `=== EQUIPO ===`,
    `Cliente: ${clientName}`,
    `Periodo: ${monthLabel(month)}${periodLabel ? ` (${periodLabel})` : ''}`,
    `Asesores evaluados: ${reports.length}`,
    `Total llamadas: ${totalLlamadas}`,
    `Promedio del equipo: ${avgScoreEquipo}/100`,
    hasPrevious ? `Nota: incluye comparativos con periodo anterior en los resúmenes por asesor.` : `Nota: primer periodo de evaluacion, sin comparativos.`,
    ``,
    `=== RESUMEN POR ASESOR ===`,
    summaries,
    ``,
    `Genera el reporte ejecutivo del equipo con la herramienta.`,
  ].join('\n');
}

// ── Tool definition ───────────────────────────────────────────────────────────

const TOOL_NAME = 'enviar_reporte_general';

const GENERAL_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Envia el reporte ejecutivo del equipo de asesores.',
  input_schema: {
    type: 'object',
    required: [
      'resumen_ejecutivo','tendencia_equipo','kpi_bullets','fortalezas_equipo',
      'areas_oportunidad','mejores_practicas','patrones_objeciones','recomendaciones',
    ],
    properties: {
      resumen_ejecutivo: { type: 'string' },
      tendencia_equipo:  { type: 'string', enum: ['mejora','estable','mixto','retroceso','primer_mes'] },
      kpi_bullets: {
        type: 'array',
        description: 'KPIs clave con valor actual, variacion vs periodo anterior y tendencia. Incluir el score de cada asesor, el score promedio del equipo, y una o dos metricas criticas del periodo que se desprendan del analisis de este cliente (por ejemplo cobertura de un elemento del guion, tasa de cierre de microcompromiso, o precalificacion). NO inventes ni menciones programas, herramientas o metricas que no aparezcan en el prompt del cliente ni en los datos. Si es primer periodo, omitir variacion.',
        items: {
          type: 'object',
          required: ['label', 'valor', 'tendencia'],
          properties: {
            label:     { type: 'string', description: 'Nombre del KPI, ej: "Score equipo", "Nombre del asesor", "% cierres con siguiente paso". Usa solo conceptos presentes en el prompt del cliente o en los datos.' },
            valor:     { type: 'string', description: 'Valor actual, ej: "53/100", "60/100", "0 de 56 llamadas"' },
            variacion: { type: 'string', description: 'Cambio vs periodo anterior, ej: "+14 pts", "-8 pts". Omitir si primer periodo.' },
            tendencia: { type: 'string', enum: ['mejora', 'baja', 'estable', 'sin_dato'] },
          },
        },
      },
      fortalezas_equipo: { type: 'array', items: { type: 'string' } },
      areas_oportunidad: { type: 'array', items: { type: 'string' } },
      mejores_practicas: {
        type: 'array', items: {
          type: 'object', required: ['asesor','practica','descripcion'],
          properties: { asesor:{type:'string'}, practica:{type:'string'}, descripcion:{type:'string'} },
        },
      },
      patrones_objeciones: {
        type: 'array', items: {
          type: 'object', required: ['categoria','frecuencia','recomendacion'],
          properties: { categoria:{type:'string'}, frecuencia:{type:'string'}, recomendacion:{type:'string'} },
        },
      },
      recomendaciones: {
        type: 'array', items: {
          type: 'object', required: ['prioridad','area','descripcion','dirigido_a'],
          properties: {
            prioridad:   { type: 'string', enum: ['alta','media','baja'] },
            area:        { type: 'string' },
            descripcion: { type: 'string' },
            dirigido_a:  { type: 'string' },
          },
        },
      },
    },
  },
};

// ── Claude call with retries ──────────────────────────────────────────────────

interface GeneralCallResult {
  data:          ClaudeGeneralOutput;
  input_tokens:  number;
  output_tokens: number;
}

async function callClaudeWithRetry(
  systemPrompt: string,
  userMessage:  string,
): Promise<GeneralCallResult> {
  let lastError: Error = new Error('No attempts made');
  let totalInput  = 0;
  let totalOutput = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await getClaude().messages.create({
        model:      MODEL,
        max_tokens: 8192,
        system:     systemPrompt + NO_DASH_INSTRUCTION,
        messages:   [{ role: 'user', content: userMessage }],
        tools:      [GENERAL_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      totalInput  += res.usage.input_tokens;
      totalOutput += res.usage.output_tokens;

      const toolBlock = res.content.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Claude response contained no tool_use block');
      }

      const parsed = ClaudeGeneralOutputSchema.safeParse(toolBlock.input);
      if (!parsed.success) {
        throw new Error(`Zod validation failed (attempt ${attempt}): ${parsed.error.message}`);
      }

      return { data: parsed.data, input_tokens: totalInput, output_tokens: totalOutput };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        console.warn(`[claude/general] Attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);
      }
    }
  }

  throw lastError;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GeneralResult {
  pdfBuffer:     Buffer;
  reportData:    GeneralReportData;
  input_tokens:  number;
  output_tokens: number;
}

export async function processGeneralReport(
  individualReports: AdvisorResult[],
  client:            ClientForGeneral,
  month:             string,
  periodLabel?:      string,
): Promise<GeneralResult> {
  if (individualReports.length === 0) {
    throw new Error('Cannot generate general report with no individual reports');
  }

  const totalLlamadas  = individualReports.reduce((s, r) => s + r.reportData.call_count, 0);
  const avgScoreEquipo = Math.round(
    individualReports.reduce((s, r) => s + r.reportData.avg_score, 0) / individualReports.length,
  );
  const ranking = buildRanking(individualReports);

  const userMessage = buildUserMessage(
    individualReports, client.name, month, avgScoreEquipo, totalLlamadas, periodLabel,
  );
  const { data: claudeOut, input_tokens, output_tokens } = await callClaudeWithRetry(client.prompt_general, userMessage);

  const now = new Date();
  const generated_date = [
    String(now.getDate()).padStart(2, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    now.getFullYear(),
  ].join('/');

  const reportData: GeneralReportData = {
    ...claudeOut,
    cliente:          client.name,
    mes_label:        monthLabel(month),
    period_label:     periodLabel,
    generated_date,
    total_asesores:   individualReports.length,
    total_llamadas:   totalLlamadas,
    avg_score_equipo: avgScoreEquipo,
    ranking,
  };

  const pdfBuffer = await renderPdf('general', reportData as unknown as Record<string, unknown>);

  return { pdfBuffer, reportData, input_tokens, output_tokens };
}
