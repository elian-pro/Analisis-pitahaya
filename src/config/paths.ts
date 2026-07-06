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
export const ADVISORS_FILE  = process.env.ADVISORS_FILE  ?? path.join(DATA_DIR, 'advisors.json');
// CLIENTS_FILE defaults to clients.json at the project root so UI additions persist there.
// Override with CLIENTS_FILE env var to use a different path (e.g. a mounted volume in Docker).
export const CLIENTS_FILE   = process.env.CLIENTS_FILE   ?? path.join(__dirname, '..', '..', 'clients.json');

// Initialize empty JSON files on first run so stores never see a missing file.
// CLIENTS_FILE is intentionally excluded: it already exists at the project root.
const defaultFiles: Record<string, unknown[]> = {
  [SCHEDULES_FILE]: [],
  [JOBS_FILE]:      [],
  [TOKEN_FILE]:     [],
  [ADVISORS_FILE]:  [],
};

for (const [filePath, defaultValue] of Object.entries(defaultFiles)) {
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      console.log(`[paths] Inicializado: ${filePath}`);
    } catch (e) {
      console.error(`[paths] Could not initialize ${filePath}:`, (e as Error).message);
    }
  }
}
