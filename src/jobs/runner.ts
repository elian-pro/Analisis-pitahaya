import { getJob, updateJob, type Job } from './store';
import { getClient, clientFileLabel } from '../clients/manager';

class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}
import { readCalls, fuenteDe } from '../calls/read';
import { MIN_DURACION_SEG } from '../calls/pipeline';
import { listAdvisors } from '../advisors/store';
import {
  findPreviousReport,
  uploadPdf,
  uploadReportSidecar,
  ensureSidecarFolder,
} from '../google/drive';
import { processAdvisor, buildSidecar, parseSidecarMetrics, type AdvisorResult } from '../claude/individual';
import { processGeneralReport } from '../claude/general';
import { mergePdfs } from '../pdf/merge';
import { runRadarForClient } from '../radar/dbFlow';
import { recordTokens } from '../tokens/store';
import { recordReportMetrics, previousReportTextFromDb } from '../metrics/store';

async function loadClient(clientId: string) {
  const client = await getClient(clientId);
  if (!client) throw new Error(`Client '${clientId}' not found`);
  return client;
}

function fmtDateShort(d: string): string {
  const parts = d.split('-');
  return `${parts[2]}/${parts[1]}`;
}

async function runBatch<T, R>(
  items:        T[],
  concurrency:  number,
  fn:           (item: T) => Promise<R>,
  isCancelled?: () => boolean,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    if (isCancelled?.()) throw new CancelledError();
    const chunk = items.slice(i, i + concurrency);
    results.push(...await Promise.allSettled(chunk.map(fn)));
  }
  return results;
}

export async function runJob(job: Job): Promise<void> {
  console.log(
    `[runner] START job=${job.id} client=${job.client_id} month=${job.month} ` +
    `period_type=${job.period_type} date_from=${job.date_from ?? '-'} date_to=${job.date_to ?? '-'} ` +
    `type=${job.type} advisors=[${job.advisors.join(', ')}]`,
  );
  updateJob(job.id, { status: 'running' });

  const isCancelled = (): boolean => getJob(job.id)?.status === 'cancelled';

  try {
    const client = await loadClient(job.client_id);
    console.log(`[runner] Client loaded: ${client.name}`);

    // Period label for filenames and templates
    const periodLabel = job.period_type === 'weekly' && job.date_from && job.date_to
      ? `Semana ${fmtDateShort(job.date_from)} al ${fmtDateShort(job.date_to)}`
      : undefined;

    // Period key for sidecar naming
    const periodKey = job.period_type === 'weekly' && job.date_from
      ? job.date_from
      : job.month;

    // ── 1. Fetch all call data for the period ────────────────────────────────
    // De donde salen las llamadas lo decide readCalls segun la fuente del
    // cliente: la hoja de siempre, o la tabla `analisis` que llena el pipeline.
    const fuente = fuenteDe(client);
    const origen = fuente === 'postgres' ? `Postgres (${client.calls_schema})` : `hoja "${client.data_sheet_name}"`;
    console.log(`[runner] Step 1: fetching call data from ${origen}...`);

    // En Postgres el roster filtra en SQL: dos clientes pueden compartir cuenta
    // y traer las llamadas del otro equipo para descartarlas seria mover datos
    // para nada. En Sheets no aplica (el filtrado es por job.advisors mas abajo).
    const roster = fuente === 'postgres'
      ? (await listAdvisors(client.id, { includeInactive: true })).map(a => a.name)
      : undefined;

    const allCalls = await readCalls(client, {
      month:    job.month,
      dateFrom: job.date_from,
      dateTo:   job.date_to,
      roster,
    });

    console.log(`[runner] Step 1 done: ${allCalls.length} llamadas encontradas para el periodo`);
    if (isCancelled()) throw new CancelledError();

    if (allCalls.length === 0) {
      throw new Error(fuente === 'postgres'
        ? `No hay llamadas analizadas en ${client.calls_schema} para el periodo indicado. `
          + `Revisa en la pestaña Llamadas si quedaron pendientes o si el equipo no tuvo llamadas de mas de `
          + `${MIN_DURACION_SEG} s.`
        : `No se encontraron llamadas en la hoja "${client.data_sheet_name}" para el periodo indicado. `
          + `Verifica que la columna "${client.col_fecha}" tenga fechas legibles y que haya registros para ese periodo.`,
      );
    }

    // ── 2. Group calls by advisor ────────────────────────────────────────────
    const callMap = new Map<string, typeof allCalls>();
    for (const call of allCalls) {
      if (!callMap.has(call.asesor)) callMap.set(call.asesor, []);
      callMap.get(call.asesor)!.push(call);
    }

    const advisorsWithData = job.advisors.filter(a => callMap.has(a));
    const skipped          = job.advisors.filter(a => !callMap.has(a));
    if (skipped.length > 0) {
      console.warn(`[runner] Sin datos para: ${skipped.join(', ')}`);
    }
    console.log(`[runner] Step 2 done: ${advisorsWithData.length}/${job.advisors.length} asesores con datos`);

    if (advisorsWithData.length === 0) {
      const foundNames = [...callMap.keys()].slice(0, 15).join(', ');
      throw new Error(
        `Los asesores solicitados [${job.advisors.join(', ')}] no tienen llamadas en el periodo. ` +
        `Nombres encontrados en la hoja: [${foundNames || 'ninguno'}]. ` +
        `Verifica mayusculas/espacios exactos en la columna "${client.col_asesor}".`,
      );
    }

    updateJob(job.id, { progress: { completed: 0, total: advisorsWithData.length } });

    // ── 3. Resolve sidecar folder ────────────────────────────────────────────
    const sidecarFolderId = client.sidecar_folder_id
      ?? await ensureSidecarFolder(client.folder_id);
    console.log(`[runner] Step 3: sidecar folder = ${sidecarFolderId}`);
    if (isCancelled()) throw new CancelledError();

    // ── 4. Analyze advisors — generate PDFs in memory ────────────────────────
    console.log(`[runner] Step 4: analyzing ${advisorsWithData.length} advisors with Claude...`);
    const individualResults: AdvisorResult[] = [];
    const failures: string[] = [];
    let completed = 0;

    const settled = await runBatch(advisorsWithData, 5, async (advisorName) => {
      console.log(`[runner]   processing advisor: ${advisorName}`);
      const calls      = callMap.get(advisorName)!;
      // Previous report: try the database first (robust + fast), fall back to the
      // Drive sidecar when the DB has nothing (e.g. periods predating this table).
      const prevText   =
        (await previousReportTextFromDb(job.client_id, advisorName, job.month, job.period_type, job.date_from))
        ?? (await findPreviousReport(sidecarFolderId, advisorName, job.month, job.period_type, job.date_from));
      const prevMetrics = prevText ? parseSidecarMetrics(prevText) : null;
      const result      = await processAdvisor(
        advisorName, calls, client, job.month, prevText, prevMetrics, periodLabel,
      );
      console.log(
        `[runner]   done: ${advisorName}, score=${result.reportData.avg_score}` +
        `${result.reportData.delta_score !== undefined ? ` delta=${result.reportData.delta_score > 0 ? '+' : ''}${result.reportData.delta_score}` : ' (primer periodo)'}`,
      );
      updateJob(job.id, { progress: { completed: ++completed, total: advisorsWithData.length } });
      return result;
    }, isCancelled);

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        individualResults.push(s.value);
      } else {
        console.error(`[runner] ${advisorsWithData[i]} failed:`, s.reason);
        failures.push(`${advisorsWithData[i]}: ${(s.reason as Error)?.message ?? s.reason}`);
      }
    }

    console.log(`[runner] Step 4 done: ${individualResults.length} ok, ${failures.length} failed`);

    if (individualResults.length === 0 && failures.length > 0) {
      updateJob(job.id, {
        status: 'error',
        error:  `Todos los asesores fallaron. ${failures.join(' | ')}`,
      });
      return;
    }

    if (individualResults.length === 0) {
      throw new Error('No se generaron reportes individuales (0 resultados, 0 fallos: estado inesperado).');
    }

    // ── 5. General report PDF ────────────────────────────────────────────────
    if (isCancelled()) throw new CancelledError();
    let generalPdfBuffer: Buffer | undefined;
    let generalInput  = 0;
    let generalOutput = 0;

    if (job.type === 'general' && individualResults.length > 0) {
      console.log(`[runner] Step 5: generating general report for ${individualResults.length} advisors...`);
      const gen        = await processGeneralReport(individualResults, client, job.month, periodLabel);
      generalPdfBuffer = gen.pdfBuffer;
      generalInput     = gen.input_tokens;
      generalOutput    = gen.output_tokens;
      console.log(`[runner] Step 5 done: general PDF size=${generalPdfBuffer?.length ?? 'undefined'}`);
    }

    // ── 6. Merge PDFs ────────────────────────────────────────────────────────
    const pdfBuffers: Buffer[] = [];
    if (generalPdfBuffer) pdfBuffers.push(generalPdfBuffer);
    individualResults.forEach(r => pdfBuffers.push(r.pdfBuffer));

    console.log(`[runner] Step 6: merging ${pdfBuffers.length} PDF(s)...`);
    const mergedBuffer = await mergePdfs(pdfBuffers);
    console.log(`[runner] Step 6 done: merged PDF size=${mergedBuffer.length}`);

    // ── 7. Upload combined PDF to client folder ──────────────────────────────
    console.log(`[runner] Step 7: uploading combined PDF to Drive folder ${client.folder_id}...`);
    const combinedUrl = await uploadPdf(
      client.folder_id,
      clientFileLabel(client),
      job.month,
      mergedBuffer,
      job.period_type === 'weekly' ? job.date_from : undefined,
      job.period_type === 'weekly' ? job.date_to   : undefined,
    );
    console.log(`[runner] Step 7 done: combined PDF = ${combinedUrl}`);

    // ── 8. Upload sidecars to _Sidecars folder ───────────────────────────────
    // These power next-period comparisons, so a silent failure here means every
    // future report shows "Primer periodo". We await + surface any failures.
    console.log(`[runner] Step 8: writing ${individualResults.length} sidecar(s) to folder ${sidecarFolderId}...`);
    // Build each sidecar text once, then write it to BOTH stores: Drive (legacy,
    // redundant) and Postgres (primary source for next-period comparison).
    const sidecars = individualResults.map(r => ({ r, text: buildSidecar(r.reportData, periodKey) }));
    const sidecarSettled = await Promise.allSettled(
      sidecars.map(({ r, text }) => uploadReportSidecar(sidecarFolderId, r.asesor, periodKey, text)),
    );
    const sidecarFailures = sidecarSettled
      .map((s, i) => (s.status === 'rejected'
        ? `${individualResults[i].asesor}: ${(s.reason as Error)?.message ?? s.reason}`
        : null))
      .filter((x): x is string => x !== null);
    if (sidecarFailures.length > 0) {
      console.error(
        `[runner] Step 8: ${sidecarFailures.length}/${individualResults.length} sidecar(s) FAILED — ` +
        `next-period comparison falls back to the database for them: ${sidecarFailures.join(' | ')}`,
      );
    } else {
      console.log(`[runner] Step 8 done: ${individualResults.length} sidecar(s) written (key=${periodKey})`);
    }

    // Persist per-advisor metrics to Postgres (no-op without DATABASE_URL). This
    // is what makes the next period's comparison robust even if a Drive sidecar
    // is missing, moved, or the Drive lookup fails.
    await Promise.allSettled(
      sidecars.map(({ r, text }) =>
        recordReportMetrics(
          job.client_id, r.asesor, periodKey,
          r.reportData.avg_score, r.reportData.pct_logra_siguiente_paso, r.reportData.talk_ratio,
          text,
        ),
      ),
    );

    // ── 8.5 Radar de Objeciones (opcional, entregable APARTE, solo mensual) ────
    // No entra al merge: se sube a su propia carpeta de Drive. Un fallo aquí es
    // parcial (el reporte de desempeño ya se subió correctamente).
    let radarResult: Awaited<ReturnType<typeof runRadarForClient>> | undefined;
    let radarInput = 0, radarOutput = 0;
    const radarErrors: string[] = [];
    if (job.include_radar && job.period_type === 'monthly') {
      if (isCancelled()) throw new CancelledError();
      try {
        console.log(`[runner] Step 8.5: generating Radar de Objeciones for ${client.name}...`);
        radarResult = await runRadarForClient(client, job.month);
        radarInput  = radarResult.input_tokens;
        radarOutput = radarResult.output_tokens;
        console.log(`[runner] Step 8.5 done: radar PDF = ${radarResult.driveUrl}`);
      } catch (e) {
        console.error(`[runner] Radar de Objeciones failed:`, (e as Error).message);
        radarErrors.push(`Radar de Objeciones: ${(e as Error).message}`);
      }
    }

    // ── 9. Finalise ──────────────────────────────────────────────────────────
    const totalInput  = individualResults.reduce((s, r) => s + r.input_tokens,  0) + generalInput  + radarInput;
    const totalOutput = individualResults.reduce((s, r) => s + r.output_tokens, 0) + generalOutput + radarOutput;
    const tokenSummary = {
      input:    totalInput,
      output:   totalOutput,
      total:    totalInput + totalOutput,
      cost_usd: (totalInput / 1e6) * 3.0 + (totalOutput / 1e6) * 15.0,
    };
    console.log(`[runner] Tokens: input=${totalInput} output=${totalOutput} cost=$${tokenSummary.cost_usd.toFixed(4)}`);

    await recordTokens(job.id, job.client_id, totalInput, totalOutput, individualResults.length);

    const finalResults = {
      individual: [],
      combined: {
        driveUrl: combinedUrl,
        advisors: individualResults.map(r => r.asesor),
      },
      ...(radarResult && { radar: { driveUrl: radarResult.driveUrl } }),
      tokens: tokenSummary,
    };
    console.log(`[runner] Step 9: finalising job, combined.driveUrl=${combinedUrl}`);
    const partialErrors = [
      ...failures,
      ...sidecarFailures.map(f => `sidecar ${f} (sin comparación el próximo periodo)`),
      ...radarErrors,
    ];
    updateJob(job.id, {
      status:  'done',
      results: finalResults,
      ...(partialErrors.length > 0 && { error: `Fallos parciales: ${partialErrors.join('; ')}` }),
    });
    console.log(`[runner] Job ${job.id} DONE`);

  } catch (err) {
    if (err instanceof CancelledError) {
      console.log(`[runner] Job ${job.id} cancelled — stopping cleanly`);
      // Status is already 'cancelled' (set by the route handler); no further update needed
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] Job ${job.id} fatal error:`, msg);
    updateJob(job.id, { status: 'error', error: msg });
  }
}
