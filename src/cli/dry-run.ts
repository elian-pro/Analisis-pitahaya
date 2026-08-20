/**
 * Dry-run CLI — genera el reporte de un asesor SIN subir nada a Drive ni tocar
 * la base: recorre exactamente el camino de produccion (readCalls decide hoja o
 * Postgres, processAdvisor arma el prompt, llama a Claude con REPORT_TOOL y
 * renderiza el PDF) y vuelca el resultado en ./fixtures.
 *
 * Existe para comparar un reporte antes y despues de tocar un prompt: se corre
 * con el prompt actual (baseline), se cambia el prompt, se vuelve a correr y se
 * diffean los dos JSON. `avg_score` no debe moverse: lo calcula computeMetrics
 * promediando las calificaciones, no lo escribe Claude.
 *
 * Usage:
 *   tsx src/cli/dry-run.ts <client_id> <month> [advisor_name] [etiqueta]
 *
 * Examples:
 *   tsx src/cli/dry-run.ts midstorage 2026-08
 *   tsx src/cli/dry-run.ts midstorage 2026-08 "Ana Perez"
 *   tsx src/cli/dry-run.ts midstorage 2026-08 "Ana Perez" antes
 *
 * La etiqueta va al nombre del fichero. Sin ella, la segunda corrida del mismo
 * asesor pisa la primera, que es justo la que hacía de baseline.
 */

import path from 'path';
import fs from 'fs';
import { getClient } from '../clients/manager';
import { listAdvisors } from '../advisors/store';
import { readCalls, fuenteDe } from '../calls/read';
import { processAdvisor } from '../claude/individual';
import { parseSidecarMetrics } from '../schemas/individual';
import { previousReportTextFromDb } from '../metrics/store';
import { findPreviousReport, monthLabel } from '../google/drive';

const [,, clientId, month, advisorArg, etiqueta] = process.argv;

if (!clientId || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('Usage: tsx src/cli/dry-run.ts <client_id> <month> [advisor_name] [etiqueta]');
  console.error('       month must be YYYY-MM, e.g. 2026-08');
  process.exit(1);
}

/** Nombres con espacios y tildes en un fichero: se quedan legibles, sin sorpresas. */
const slug = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const client = await getClient(clientId);
  if (!client) {
    console.error(`Cliente '${clientId}' no encontrado.`);
    process.exit(1);
  }

  const fuente = fuenteDe(client);
  console.log(`\n🦓 Zebra Reports — Dry Run`);
  console.log(`   Cliente : ${client.name}`);
  console.log(`   Periodo : ${monthLabel(month)} (${month})`);
  console.log(`   Fuente  : ${fuente === 'postgres' ? `Postgres (${client.calls_schema})` : `hoja "${client.data_sheet_name}"`}`);
  console.log(`   Prompt  : ${client.prompt_individual?.trim() ? 'propio del cliente' : 'esqueleto estandar'}`);
  console.log(`   Contexto: ${client.contexto_negocio?.trim() ? `${client.contexto_negocio.trim().length} chars` : 'SIN CONTEXTO'}\n`);

  // Mismo filtrado por roster que el runner: en Postgres dos clientes pueden
  // compartir cuenta y lo que los distingue son los asesores.
  const roster = fuente === 'postgres'
    ? (await listAdvisors(client.id, { includeInactive: true })).map(a => a.name)
    : undefined;

  const calls = await readCalls(client, { month, roster });
  console.log(`📊 ${calls.length} llamada(s) en el periodo\n`);

  const byAdvisor = new Map<string, typeof calls>();
  for (const c of calls) {
    if (!byAdvisor.has(c.asesor)) byAdvisor.set(c.asesor, []);
    byAdvisor.get(c.asesor)!.push(c);
  }

  for (const [name, rows] of byAdvisor) {
    const scores = rows.map(r => parseFloat(r.calif)).filter(s => !isNaN(s));
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 'N/A';
    console.log(`   ${name.padEnd(22)} ${String(rows.length).padStart(3)} llamada(s)   promedio: ${avg}`);
  }

  if (!advisorArg) {
    const primero = [...byAdvisor.keys()][0] ?? 'Asesor';
    console.log(`\n💡 Pasa un asesor como tercer argumento para generar su reporte completo.`);
    console.log(`   tsx src/cli/dry-run.ts ${clientId} ${month} "${primero}" antes`);
    return;
  }

  const advisorCalls = byAdvisor.get(advisorArg);
  if (!advisorCalls?.length) {
    console.error(`\n❌ '${advisorArg}' no tiene llamadas en ${month}.`);
    process.exit(1);
  }

  // El reporte anterior entra en el prompt, asi que el dry-run tiene que
  // buscarlo igual que el runner o el baseline no seria comparable. Diferencia
  // deliberada: no se crea la carpeta de sidecars si no existe (seria un efecto
  // en Drive, justo lo que un dry-run promete no hacer).
  const prevText =
    (await previousReportTextFromDb(client.id, advisorArg, month, 'monthly'))
    ?? (client.sidecar_folder_id
      ? await findPreviousReport(client.sidecar_folder_id, advisorArg, month)
      : null);
  console.log(prevText
    ? `\n📎 Reporte anterior encontrado — entra en el prompt`
    : `\n📎 Sin reporte anterior — primer periodo`);

  console.log(`🤖 Generando reporte de "${advisorArg}" (${advisorCalls.length} llamada(s))...`);

  const result = await processAdvisor(
    advisorArg, advisorCalls, client, month, prevText, prevText ? parseSidecarMetrics(prevText) : null,
  );
  const d = result.reportData;

  fs.mkdirSync('fixtures', { recursive: true });
  const base    = path.join('fixtures',
    `dry-run-${slug(client.id)}-${slug(advisorArg)}-${month}${etiqueta ? '-' + slug(etiqueta) : ''}`);
  const jsonOut = `${base}.json`;
  const pdfOut  = `${base}.pdf`;
  fs.writeFileSync(jsonOut, JSON.stringify(d, null, 2));
  fs.writeFileSync(pdfOut, result.pdfBuffer);

  console.log(`\n✅ Reporte valido (los 22 campos del schema)`);
  console.log(`   avg_score   : ${d.avg_score}   ← determinista, NO debe moverse al cambiar el prompt`);
  console.log(`   tipo_asesor : ${d.tipo_asesor}`);
  console.log(`   criterios   : ${d.criterios.length}`);
  console.log(`   objeciones  : ${d.objeciones.length}`);
  console.log(`   recs        : ${d.recomendaciones.length}`);
  console.log(`   tokens      : ${result.input_tokens} in / ${result.output_tokens} out`);
  console.log(`\n   ${jsonOut}`);
  console.log(`   ${pdfOut}  (${Math.round(result.pdfBuffer.length / 1024)} KB)`);
  console.log(`\n   Comparar con otra corrida:  npm run dry-run:diff -- <antes.json> ${jsonOut}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\n❌ Error:', (err as Error).message);
  process.exit(1);
});
