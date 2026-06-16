import path from 'path';
import fs from 'fs';

// DATA_DIR should point to a persistent volume in production.
// In EasyPanel: mount a volume and set DATA_DIR=/data (or any mounted path).
// Default: <project-root>/data/ (works locally; not persistent across container rebuilds).
const DATA_DIR = process.env.DATA_DIR
  ?? path.join(__dirname, '..', '..', 'data');

// Ensure the directory exists at startup so writes never fail silently
try { fs.mkdirSync(DATA_DIR, { recursive: true }); }
catch (e) { console.error('[paths] Could not create DATA_DIR:', (e as Error).message); }

export const SCHEDULES_FILE = process.env.SCHEDULES_FILE ?? path.join(DATA_DIR, 'schedules.json');
export const JOBS_FILE      = process.env.JOBS_FILE      ?? path.join(DATA_DIR, 'jobs.json');
export const TOKEN_FILE     = process.env.TOKEN_LOG_FILE ?? path.join(DATA_DIR, 'token_log.json');
