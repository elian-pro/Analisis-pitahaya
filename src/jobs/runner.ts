import path from 'path';
import fs from 'fs';
import { updateJob, type Job } from './store';
import { getCallData, type SheetColumns } from '../google/sheets';
import { findPreviousReport } from '../google/drive';
import { processAdvisor, type AdvisorResult } from '../claude/individual';
import { processGeneralReport } from '../claude/general';

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
  updateJob(job.id, { status: 'running' });

  try {
    const client = loadClient(job.client_id);

    // ── 1. Fetch all call data for the month ─────────────────────────────────
    const cols: SheetColumns = {
      fecha:         client.col_fecha,
      asesor:        client.col_asesor,
      calif:         client.col_calif,
      analisis:      client.col_analisis,
      transcripcion: client.col_transcripcion,
    };

    const allCalls = await getCallData(
      client.spreadsheet_id,
      client.data_sheet_name,
      cols,
      job.month,
      client.excluded_phrases,
      client.transcripcion_max_chars,
    );

    // ── 2. Group calls by advisor ─────────────────────────────────────────────
    const callMap = new Map<string, typeof allCalls>();
    for (const call of allCalls) {
      if (!callMap.has(call.asesor)) callMap.set(call.asesor, []);
      callMap.get(call.asesor)!.push(call);
    }

    // Keep only requested advisors that have calls
    const advisorsWithData = job.advisors.filter(a => callMap.has(a));
    const skipped = job.advisors.filter(a => !callMap.has(a));
    if (skipped.length > 0) {
      console.warn(`[runner] No calls found for: ${skipped.join(', ')} — skipping`);
    }

    updateJob(job.id, { progress: { completed: 0, total: advisorsWithData.length } });

    // ── 3. Process advisors in parallel batches of 5 ─────────────────────────
    const individualResults: AdvisorResult[] = [];
    let completed = 0;

    const settled = await runBatch(advisorsWithData, 5, async (advisorName) => {
      const calls      = callMap.get(advisorName)!;
      const prevReport = await findPreviousReport(client.folder_id, advisorName, job.month);
      const result     = await processAdvisor(advisorName, calls, client, job.month, prevReport);
      updateJob(job.id, { progress: { completed: ++completed, total: advisorsWithData.length } });
      return result;
    });

    const failures: string[] = [];
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        individualResults.push(s.value);
      } else {
        console.error(`[runner] ${advisorsWithData[i]} failed:`, s.reason);
        failures.push(`${advisorsWithData[i]}: ${(s.reason as Error)?.message ?? s.reason}`);
      }
    }

    // ── 4. General report (only for 'general' type) ───────────────────────────
    let generalResult: { driveUrl: string } | undefined;

    if (job.type === 'general' && individualResults.length > 0) {
      console.log(`[runner] Generating general report for ${individualResults.length} advisors`);
      const gen = await processGeneralReport(individualResults, client, job.month);
      generalResult = { driveUrl: gen.driveUrl };
    }

    // ── 5. Finalise ───────────────────────────────────────────────────────────
    updateJob(job.id, {
      status: 'done',
      results: {
        individual: individualResults.map(r => ({ asesor: r.asesor, driveUrl: r.driveUrl })),
        general: generalResult,
      },
      // Surface partial failures as a non-blocking warning in the error field
      ...(failures.length > 0 && { error: `Partial failures: ${failures.join('; ')}` }),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[runner] Job ${job.id} fatal error:`, msg);
    updateJob(job.id, { status: 'error', error: msg });
  }
}
