import fs from 'fs';
import crypto from 'crypto';

export type JobStatus = 'pending' | 'running' | 'done' | 'error';

export interface JobResult {
  individual: Array<{ asesor: string; driveUrl: string }>;
  general?:   { driveUrl: string };
  combined?:  { driveUrl: string; advisors: string[] };
}

export interface Job {
  id:         string;
  status:     JobStatus;
  created_at: string;
  updated_at: string;
  client_id:  string;
  month:      string;
  type:       'selected' | 'general';
  advisors:   string[];
  progress:   { completed: number; total: number };
  results?:   JobResult;
  error?:     string;
}

const JOBS_FILE = process.env.JOBS_FILE ?? '/tmp/jobs.json';
const store = new Map<string, Job>();

// Restore persisted jobs on startup; interrupt any that were mid-flight
try {
  const saved: Job[] = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  for (const job of saved) {
    if (job.status === 'pending' || job.status === 'running') {
      job.status = 'error';
      job.error  = 'Service restarted while job was in progress';
    }
    store.set(job.id, job);
  }
  console.log(`[jobs/store] Restored ${store.size} job(s) from disk`);
} catch {
  // No file or parse error — start fresh
}

function persist(): void {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(Array.from(store.values())), 'utf-8');
  } catch (err) {
    console.warn('[jobs/store] Persist failed:', (err as Error).message);
  }
}

export function createJob(
  client_id: string,
  month:     string,
  type:      'selected' | 'general',
  advisors:  string[],
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
  };
  store.set(job.id, job);
  persist();
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function updateJob(id: string, patch: Partial<Omit<Job, 'id' | 'created_at'>>): Job {
  const job = store.get(id);
  if (!job) throw new Error(`Job ${id} not found`);
  Object.assign(job, patch, { updated_at: new Date().toISOString() });
  persist();
  return job;
}
