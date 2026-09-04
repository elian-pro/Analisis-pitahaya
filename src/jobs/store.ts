import fs from 'fs';
import crypto from 'crypto';
import { JOBS_FILE } from '../config/paths';
import { dbEnabled, JOBS_TABLE, dbLoadAll, dbUpsert } from '../config/db';
import { humanizeError } from '../humanizeError';

export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface TokenSummary {
  input:    number;
  output:   number;
  total:    number;
  cost_usd: number;
}

export interface JobResult {
  individual: Array<{ asesor: string; driveUrl: string }>;
  general?:   { driveUrl: string };
  // driveUrl (entrega por Drive) o download+filename (descarga efímera del
  // cliente externo: GET /api/report/:jobId/download, un solo uso, 30 min).
  combined?:  { driveUrl?: string; download?: true; filename?: string; advisors: string[] };
  radar?:     { driveUrl: string };   // Radar de Objeciones (archivo aparte, no va en el merge)
  tokens?:    TokenSummary;
}

export interface Job {
  id:          string;
  status:      JobStatus;
  created_at:  string;
  updated_at:  string;
  client_id:   string;
  month:       string;
  type:        'selected' | 'general';
  advisors:    string[];
  progress:    { completed: number; total: number };
  results?:    JobResult;
  error?:      string;
  period_type: 'monthly' | 'weekly';
  date_from?:  string;  // YYYY-MM-DD, required for weekly
  date_to?:    string;  // YYYY-MM-DD, required for weekly
  include_radar?: boolean;  // genera además el Radar de Objeciones (solo mensual)
}

// In-memory cache is the source of truth for reads (the runner polls job status
// very frequently, e.g. to detect cancellation). Writes go through to Postgres
// (or the JSON file) for durability so the history survives redeploys.
const store = new Map<string, Job>();

function loadFromFile(): Job[] {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')); }
  catch { return []; }
}

// Persists a single job. Postgres write is fire-and-forget (the in-memory cache
// already holds the authoritative value, so a request never waits on the DB and
// the hot polling path stays synchronous). File mode rewrites the whole set.
function persist(job: Job): void {
  if (dbEnabled) {
    dbUpsert(JOBS_TABLE, job.id, job).catch(err =>
      console.warn('[jobs/store] DB upsert failed:', (err as Error).message),
    );
    return;
  }
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(Array.from(store.values())), 'utf-8');
  } catch (err) {
    console.warn('[jobs/store] Persist failed:', (err as Error).message);
  }
}

/**
 * Loads existing jobs into the in-memory cache at startup. Any job left
 * 'pending' or 'running' (i.e. interrupted by a restart) is marked 'error'.
 * On first boot with a database, migrates jobs from the legacy JSON file.
 */
export async function initJobs(): Promise<void> {
  let saved: Job[] = [];
  if (dbEnabled) {
    saved = await dbLoadAll<Job>(JOBS_TABLE);
    if (saved.length === 0) {
      const fromFile = loadFromFile();
      for (const job of fromFile) await dbUpsert(JOBS_TABLE, job.id, job);
      if (fromFile.length > 0) {
        console.log(`[jobs/store] Seeded ${fromFile.length} job(s) from jobs.json into Postgres`);
      }
      saved = fromFile;
    }
  } else {
    saved = loadFromFile();
  }

  const corrected: Job[] = [];
  for (const job of saved) {
    if (job.status === 'pending' || job.status === 'running') {
      job.status = 'error';
      job.error  = 'Service restarted while job was in progress';
      corrected.push(job);
    }
    store.set(job.id, job);
  }
  for (const job of corrected) persist(job);

  console.log(`[jobs/store] Restored ${store.size} job(s)`);
}

export function createJob(
  client_id:   string,
  month:       string,
  type:        'selected' | 'general',
  advisors:    string[],
  period_type: 'monthly' | 'weekly' = 'monthly',
  date_from?:  string,
  date_to?:    string,
  include_radar = false,
): Job {
  const job: Job = {
    id:         crypto.randomUUID(),
    status:     'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    client_id,
    month,
    type,
    advisors,
    progress:   { completed: 0, total: advisors.length },
    period_type,
    date_from,
    date_to,
    include_radar,
  };
  store.set(job.id, job);
  persist(job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function updateJob(id: string, patch: Partial<Omit<Job, 'id' | 'created_at'>>): Job {
  const job = store.get(id);
  if (!job) throw new Error(`Job ${id} not found`);
  // El `error` del job lo lee la UI y lo reenvía el scheduler a Chat: se guarda
  // ya traducido. El crudo queda en los logs del runner, que es donde se depura.
  if (patch.error) patch = { ...patch, error: humanizeError(patch.error) };
  Object.assign(job, patch, { updated_at: new Date().toISOString() });
  persist(job);
  return job;
}
