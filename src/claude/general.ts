import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import {
  ClaudeGeneralOutputSchema,
  type ClaudeGeneralOutput,
  type GeneralReportData,
} from '../schemas/general';
import type { AdvisorResult } from './individual';
import { renderPdf } from '../pdf/renderer';
import { uploadPdf, monthLabel } from '../google/drive';

interface ClientForGeneral {
  name: string;
  folder_id: string;
  prompt_general: string;
}

const MAX_RETRIES = 3;
const MODEL = 'claude-sonnet-4-6';

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
      posicion:   i + 1,
      asesor:     r.asesor,
      avg_score:  r.reportData.avg_score,
      score_min:  r.reportData.score_min,
      score_max:  r.reportData.score_max,
      call_count: r.reportData.call_count,
      nivel:      r.reportData.nivel,
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

  return [
    `--- ${d.asesor} | ${d.nivel.toUpperCase()} | ${d.avg_score}/100 | ${d.call_count} llamadas ---`,
    `Resumen: ${d.resumen}`,
    `Criterios:\n${criterios}`,
    `Debilidades principales:\n${debilidades}`,
    `Top recomendaciones:\n${recs}`,
  ].join('\n');
}

function buildUserMessage(
  reports: AdvisorResult[],
  clientName: string,
  month: string,
  avgScoreEquipo: number,
  totalLlamadas: number,
): string {
  const summaries = reports.map(summarizeAdvisor).join('\n\n');

  return [
    `=== EQUIPO ===`,
    `Cliente: ${clientName}`,
    `Mes: ${monthLabel(month)}`,
    `Asesores evaluados: ${reports.length}`,
    `Total llamadas: ${totalLlamadas}`,
    `Promedio del equipo: ${avgScoreEquipo}/100`,
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
  description: 'Envía el reporte ejecutivo del equipo de asesores.',
  input_schema: {
    type: 'object',
    required: [
      'resumen_ejecutivo','tendencia_equipo','fortalezas_equipo',
      'areas_oportunidad','mejores_practicas','patrones_objeciones','recomendaciones',
    ],
    properties: {
      resumen_ejecutivo: { type: 'string' },
      tendencia_equipo:  { type: 'string', enum: ['mejora','estable','mixto','retroceso','primer_mes'] },
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
            prioridad:  { type: 'string', enum: ['alta','media','baja'] },
            area:       { type: 'string' },
            descripcion:{ type: 'string' },
            dirigido_a: { type: 'string' },
          },
        },
      },
    },
  },
};

// ── Claude call with retries ──────────────────────────────────────────────────

async function callClaudeWithRetry(
  systemPrompt: string,
  userMessage: string,
): Promise<ClaudeGeneralOutput> {
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await getClaude().messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [GENERAL_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const toolBlock = res.content.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Claude response contained no tool_use block');
      }

      const parsed = ClaudeGeneralOutputSchema.safeParse(toolBlock.input);
      if (!parsed.success) {
        throw new Error(`Zod validation failed (attempt ${attempt}): ${parsed.error.message}`);
      }

      return parsed.data;
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
  driveUrl:   string;
  reportData: GeneralReportData;
}

export async function processGeneralReport(
  individualReports: AdvisorResult[],
  client: ClientForGeneral,
  month: string,
): Promise<GeneralResult> {
  if (individualReports.length === 0) {
    throw new Error('Cannot generate general report with no individual reports');
  }

  const totalLlamadas   = individualReports.reduce((s, r) => s + r.reportData.call_count, 0);
  const avgScoreEquipo  = Math.round(
    individualReports.reduce((s, r) => s + r.reportData.avg_score, 0) / individualReports.length,
  );
  const ranking = buildRanking(individualReports);

  const userMessage = buildUserMessage(
    individualReports, client.name, month, avgScoreEquipo, totalLlamadas,
  );
  const claudeOut = await callClaudeWithRetry(client.prompt_general, userMessage);

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
    generated_date,
    total_asesores:   individualReports.length,
    total_llamadas:   totalLlamadas,
    avg_score_equipo: avgScoreEquipo,
    ranking,
  };

  const pdfBuffer = await renderPdf('general', reportData as unknown as Record<string, unknown>);
  const driveUrl  = await uploadPdf(client.folder_id, 'General', month, pdfBuffer);

  return { driveUrl, reportData };
}
