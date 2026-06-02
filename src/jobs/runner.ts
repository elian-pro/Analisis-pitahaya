import path from 'path';
import fs from 'fs';
import { updateJob, type Job } from './store';
import { getCallData, type SheetColumns } from '../google/sheets';
import { findPreviousReport, uploadPdf, uploadReportSidecar, monthLabel } from '../google/drive';
import { processAdvisor, buildSidecar, type AdvisorResult } from '../claude/individual';
import { processGeneralReport } from '../claude/general';
import { mergePdfs } from '../pdf/merge';

interface ClientConfig {
  id:                     string;
  name:                   string;
  folder_id:              string;
  spreadsheet_id:         string;
  data_sheet_name:        string;
  col_fecha:              string;
  col_asesor:             string;
  col_calif:              string;
  col_analisis:           string;
  col_transcripcion:      string;
  excluded_phrases:       string[];
  transcripcion_max_chars: number;
  prompt_individual:      string;
  prompt_general:         string;
}

function loadClient(clientId: string): ClientConfig {
  const p = path.join(__dirname, '..', '..', 'clients.json');
  const all: ClientConfig[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const client = all.find(c => c.id === clientId);
  if (!client) throw new Error(`Client '${clientId}' not found in clients.json`);
  return client;
}

async function runBatch<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...await Promise.allSettled(chunk.map(fn)));
  }
  return results;
}

export async function runJob(job: Job): Promise<void> {
  console.log(`[runner] ▶ START job=${job.id} client=${job.client_id} month=${job.month} type=${job.type} advisors=[${job.advisors.join(', ')}]`);
  updateJob(job.id, { status: 'running' });

  try {
    const client = loadClient(job.client_id);
    console.log(`[runner] ✓ Client loaded: ${client.name}`);

    // ── 1. Fetch all call data for the month ─────────────────────────────────
    const cols: SheetColumns = {
      fecha:         client.col_fecha,
      asesor:        client.col_asesor,
      calif:         client.col_calif,
      analisis:      client.col_analisis,
      transcripcion: client.col_transcripcion,
    };

    console.log(`[runner] ► Step 1: fetching call data from sheet "${client.data_sheet_name}"…`);
    const allCalls = await getCallData(
      client.spreadsheet_id,
      client.data_sheet_name,
      cols,
      job.month,
      client.excluded_phrases,
      client.transcripcion_max_chars,
    );

    console.log(`[runner] ✓ Step 1: ${allCalls.length} llamadas encontradas para ${job.month}`);

    if (allCalls.length === 0) {
      throw new Error(
        `No se encontraron llamadas en la hoja "${client.data_sheet_name}" para el mes ${job.month}. ` +
        `Verifica que la columna "${client.col_fecha}" tenga fechas legibles y que haya registros para ese período.`,
      );
    }

    // ── 2. Group calls by advisor ─────────────────────────────────────────────
    const callMap = new Map<string, typeof allCalls>();
    for (const call of allCalls) {
      if (!callMap.has(call.asesor)) callMap.set(call.asesor, []);
      callMap.get(call.asesor)!.push(call);
    }

    const advisorsWithData = job.advisors.filter(a => callMap.has(a));
    const skipped = job.advisors.filter(a => !callMap.has(a));
    if (skipped.length > 0) {
      console.warn(`[runner] ⚠ Sin datos para: ${skipped.join(', ')}`);
    }
    console.log(`[runner] ✓ Step 2: ${advisorsWithData.length}/${job.advisors.length} asesores con datos`);

    if (advisorsWithData.length === 0) {
      const foundNames = [...callMap.keys()].slice(0, 15).join(', ');
      throw new Error(
        `Los asesores solicitados [${job.advisors.join(', ')}] no tienen llamadas en ${job.month}. ` +
        `Nombres encontrados en la hoja: [${foundNames || 'ninguno'}]. ` +
        `Verifica mayúsculas/espacios exactos en la columna "${client.col_asesor}".`,
      );
    }

    updateJob(job.id, { progress: { completed: 0, total: advisorsWithData.length } });

    // ── 3. Analyze advisors — generate PDFs in memory, no upload yet ─────────
    console.log(`[runner] ► Step 3: analyzing ${advisorsWithData.length} advisors with Claude…`);
    const individualResults: AdvisorResult[] = [];
    const failures: string[] = [];
    let completed = 0;

    const settled = await runBatch(advisorsWithData, 5, async (advisorName) => {
      console.log(`[runner]   → processing advisor: ${advisorName}`);
      const calls      = callMap.get(advisorName)!;
      const prevReport = await findPreviousReport(client.folder_id, advisorName, job.month);
      const result     = await processAdvisor(advisorName, calls, client, job.month, prevReport);
      console.log(`[runner]   ✓ advisor done: ${advisorName}, pdfBuffer size=${result.pdfBuffer?.length ?? 'undefined'}`);
      updateJob(job.id, { progress: { completed: ++completed, total: advisorsWithData.length } });
      return result;
    });

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        individualResults.push(s.value);
      } else {
        console.error(`[runner] ✗ ${advisorsWithData[i]} failed:`, s.reason);
        failures.push(`${advisorsWithData[i]}: ${(s.reason as Error)?.message ?? s.reason}`);
      }
    }

    console.log(`[runner] ✓ Step 3: ${individualResults.length} succeeded, ${failures.length} failed`);

    if (individualResults.length === 0 && failures.length > 0) {
      updateJob(job.id, {
        status: 'error',
        error: `Todos los asesores fallaron. ${failures.join(' | ')}`,
      });
      return;
    }

    if (individualResults.length === 0) {
      throw new Error('No se generaron reportes individuales (0 resultados, 0 fallos — estado inesperado).');
    }

    // ── 4. General report PDF (only for 'general' type) ───────────────────────
    let generalPdfBuffer: Buffer | undefined;

    if (job.type === 'general' && individualResults.length > 0) {
      console.log(`[runner] ► Step 4: generating general report for ${individualResults.length} advisors…`);
      const gen = await processGeneralReport(individualResults, client, job.month);
      generalPdfBuffer = gen.pdfBuffer;
      console.log(`[runner] ✓ Step 4: general PDF generated, size=${generalPdfBuffer?.length ?? 'undefined'}`);
    }

    // ── 5. Merge: general first, then individual by result order ─────────────
    const pdfBuffers: Buffer[] = [];
    if (generalPdfBuffer) pdfBuffers.push(generalPdfBuffer);
    individualResults.forEach(r => pdfBuffers.push(r.pdfBuffer));

    console.log(`[runner] ► Step 5: merging ${pdfBuffers.length} PDF(s)…`);
    const mergedBuffer = await mergePdfs(pdfBuffers);
    console.log(`[runner] ✓ Step 5: merged PDF size=${mergedBuffer.length}`);

    // ── 6. Upload single combined PDF ─────────────────────────────────────────
    console.log(`[runner] ► Step 6: uploading combined PDF to Drive folder ${client.folder_id}…`);
    const combinedUrl = await uploadPdf(client.folder_id, client.name, job.month, mergedBuffer);
    console.log(`[runner] ✓ Step 6: Combined PDF uploaded: ${combinedUrl}`);

    // ── 7. Upload sidecars for next-month comparison (best-effort) ────────────
    for (const r of individualResults) {
      uploadReportSidecar(client.folder_id, r.asesor, job.month, buildSidecar(r.reportData))
        .catch(err => console.warn(`[runner] sidecar ${r.asesor} failed:`, (err as Error).message));
    }

    // ── 8. Finalise ───────────────────────────────────────────────────────────
    const finalResults = {
      individual: [],
      combined: {
        driveUrl: combinedUrl,
        advisors: individualResults.map(r => r.asesor),
      },
    };
    console.log(`[runner] ► Step 8: finalising job, combined.driveUrl=${combinedUrl}`);
    updateJob(job.id, {
      status: 'done',
      results: finalResults,
      ...(failures.length > 0 && { error: `Fallos parciales: ${failures.join('; ')}` }),
    });
    console.log(`[runner] ✓ Job ${job.id} DONE`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] ✗ Job ${job.id} fatal error:`, msg);
    updateJob(job.id, { status: 'error', error: msg });
  }
}
