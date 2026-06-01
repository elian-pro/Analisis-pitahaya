/**
 * Dry-run CLI — reads Google Sheets data, prints stats, optionally runs Claude
 * and saves output to ./fixtures/ without uploading anything to Drive.
 *
 * Usage:
 *   tsx src/cli/dry-run.ts <client_id> <month>
 *   tsx src/cli/dry-run.ts <client_id> <month> <advisor_name>
 *
 * Examples:
 *   tsx src/cli/dry-run.ts pitahaya-investments 2026-05
 *   tsx src/cli/dry-run.ts pitahaya-investments 2026-05 Felipe
 */

import path from 'path';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { getCallData, getAdvisors } from '../google/sheets';
import { findPreviousReport, monthLabel } from '../google/drive';
import {
  ClaudeIndividualOutputSchema,
} from '../schemas/individual';
import { env } from '../config/env';

const [,, clientId, month, advisorArg] = process.argv;

if (!clientId || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('Usage: tsx src/cli/dry-run.ts <client_id> <month> [advisor_name]');
  console.error('       month must be YYYY-MM, e.g. 2026-05');
  process.exit(1);
}

interface ClientConfig {
  id: string; name: string; folder_id: string; spreadsheet_id: string;
  data_sheet_name: string; advisors_sheet_name: string;
  col_fecha: string; col_asesor: string; col_calif: string;
  col_analisis: string; col_transcripcion: string;
  excluded_phrases: string[]; transcripcion_max_chars: number;
  prompt_individual: string; prompt_general: string;
}

function loadClient(id: string): ClientConfig {
  const p = path.join(__dirname, '..', '..', 'clients.json');
  const all: ClientConfig[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const c = all.find(x => x.id === id);
  if (!c) {
    console.error(`Client '${id}' not found. Available: ${all.map(x => x.id).join(', ')}`);
    process.exit(1);
  }
  return c;
}

async function main() {
  const client = loadClient(clientId);

  console.log(`\n🦓 Zebra Reports — Dry Run`);
  console.log(`   Client : ${client.name}`);
  console.log(`   Month  : ${monthLabel(month)} (${month})\n`);

  // ── 1. Advisor list ───────────────────────────────────────────────────────
  console.log('📋 Loading advisor list...');
  const advisors = await getAdvisors(
    client.spreadsheet_id,
    client.advisors_sheet_name,
    client.col_asesor,
  );
  console.log(`   Found ${advisors.length} advisor(s): ${advisors.map(a => a.asesor).join(', ')}\n`);

  // ── 2. Call data ─────────────────────────────────────────────────────────
  console.log('📊 Loading call data from sheet...');
  const calls = await getCallData(
    client.spreadsheet_id,
    client.data_sheet_name,
    {
      fecha: client.col_fecha, asesor: client.col_asesor,
      calif: client.col_calif, analisis: client.col_analisis,
      transcripcion: client.col_transcripcion,
    },
    month,
    client.excluded_phrases,
    client.transcripcion_max_chars,
  );
  console.log(`   ${calls.length} call(s) found in ${monthLabel(month)}`);

  const byAdvisor = new Map<string, typeof calls>();
  for (const c of calls) {
    if (!byAdvisor.has(c.asesor)) byAdvisor.set(c.asesor, []);
    byAdvisor.get(c.asesor)!.push(c);
  }

  console.log('\n   Breakdown by advisor:');
  for (const [name, rows] of byAdvisor) {
    const scores = rows.map(r => parseFloat(r.calif)).filter(s => !isNaN(s));
    const avg = scores.length
      ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
      : 'N/A';
    console.log(`     ${name.padEnd(22)} ${rows.length} call(s)   avg score: ${avg}`);
  }

  if (!advisorArg) {
    console.log('\n💡 Pass an advisor name as 3rd argument to run a Claude dry-run for that advisor.');
    console.log('   Example: tsx src/cli/dry-run.ts ' + clientId + ' ' + month + ' "' + (advisors[0]?.asesor ?? 'Asesor') + '"');
    return;
  }

  // ── 3. Claude dry-run for one advisor ─────────────────────────────────────
  const advisorCalls = byAdvisor.get(advisorArg);
  if (!advisorCalls?.length) {
    console.error(`\n❌ No calls found for '${advisorArg}' in ${month}`);
    process.exit(1);
  }

  console.log(`\n🤖 Running Claude analysis for "${advisorArg}" (${advisorCalls.length} call(s))...`);
  console.log('   (No PDF rendered, no Drive upload)');

  const prevReport = await findPreviousReport(client.folder_id, advisorArg, month);
  console.log(prevReport
    ? '   📎 Previous report found — included in prompt'
    : '   📎 No previous report — first month');

  // Build prompt (same as production path)
  const callsText = advisorCalls.map((c, i) => {
    const parts = [`--- Call ${i + 1} | ${c.fecha} | Score: ${c.calif} ---`];
    if (c.analisis) parts.push(`ANÁLISIS PREVIO:\n${c.analisis}`);
    parts.push(`TRANSCRIPCIÓN:\n${c.transcripcion}`);
    return parts.join('\n');
  }).join('\n\n');

  const userMessage = [
    `=== DATOS DEL MES ===`,
    `Asesor: ${advisorArg}`,
    `Mes: ${monthLabel(month)}`,
    `Llamadas: ${advisorCalls.length}`,
    ``,
    `=== LLAMADAS ===`,
    callsText,
    ``,
    `=== REPORTE MES ANTERIOR ===`,
    prevReport ?? 'Sin reporte previo — primer mes de evaluación.',
    ``,
    `Analiza el desempeño del asesor usando la herramienta.`,
  ].join('\n');

  const TOOL_NAME = 'enviar_reporte_individual';
  const claude = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const res = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: client.prompt_individual,
    messages: [{ role: 'user', content: userMessage }],
    tools: [{
      name: TOOL_NAME,
      description: 'Envía el reporte estructurado del asesor.',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    }],
    tool_choice: { type: 'tool', name: TOOL_NAME },
  });

  const toolBlock = res.content.find(b => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('No tool_use block in Claude response');
  }

  const parsed = ClaudeIndividualOutputSchema.safeParse(toolBlock.input);
  if (!parsed.success) {
    console.error('\n❌ Schema validation failed:');
    console.error(parsed.error.message);
    const outBad = path.join('fixtures', `dry-run-${advisorArg}-${month}-INVALID.json`);
    fs.mkdirSync('fixtures', { recursive: true });
    fs.writeFileSync(outBad, JSON.stringify(toolBlock.input, null, 2));
    console.error(`   Raw output saved to ${outBad}`);
    process.exit(1);
  }

  const outFile = path.join('fixtures', `dry-run-${advisorArg}-${month}.json`);
  fs.mkdirSync('fixtures', { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(parsed.data, null, 2));

  console.log(`\n✅ Claude output validated successfully`);
  console.log(`   nivel     : ${parsed.data.nivel}`);
  console.log(`   tipo      : ${parsed.data.tipo_asesor}`);
  console.log(`   criterios : ${parsed.data.criterios.length}`);
  console.log(`   objeciones: ${parsed.data.objeciones.length}`);
  console.log(`   recs      : ${parsed.data.recomendaciones.length}`);
  console.log(`\n   Output saved to: ${outFile}`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', (err as Error).message);
  process.exit(1);
});
