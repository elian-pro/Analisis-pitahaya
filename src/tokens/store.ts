import fs from 'fs';
import { TOKEN_FILE } from '../config/paths';
import { dbEnabled, pool, TOKEN_LOG_TABLE } from '../config/db';

interface TokenEntry {
  ts:        string;   // ISO timestamp
  job_id:    string;
  client_id: string;
  input:     number;
  output:    number;
  advisors:  number;
}

// ── File fallback (used only when DATABASE_URL is not set) ───────────────────
function loadFromFile(): TokenEntry[] {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')); }
  catch { return []; }
}

function persistToFile(entries: TokenEntry[]): void {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(entries), 'utf-8'); }
  catch (e) { console.warn('[tokens] persist failed:', (e as Error).message); }
}

// ── Public API (async: Postgres when DATABASE_URL is set, else JSON file) ────

export async function recordTokens(
  job_id:    string,
  client_id: string,
  input:     number,
  output:    number,
  advisors:  number,
): Promise<void> {
  if (dbEnabled) {
    try {
      await pool!.query(
        `INSERT INTO ${TOKEN_LOG_TABLE} (job_id, client_id, input, output, advisors)
         VALUES ($1, $2, $3, $4, $5)`,
        [job_id, client_id, input, output, advisors],
      );
    } catch (e) {
      console.warn('[tokens] DB insert failed:', (e as Error).message);
    }
    return;
  }
  const entries = loadFromFile();
  entries.push({ ts: new Date().toISOString(), job_id, client_id, input, output, advisors });
  persistToFile(entries);
}

export interface DayBucket { date: string; total: number; }

export interface TokenStats {
  input:    number;
  output:   number;
  total:    number;
  cost_usd: number;
  jobs:     number;
  advisors: number;
  by_day:   DayBucket[];
}

const INPUT_CPM  = 3.0;
const OUTPUT_CPM = 15.0;

// Aggregates a set of entries into the stats shape. Shared by both backends so
// the numbers are computed identically regardless of where the data lives.
function aggregate(entries: TokenEntry[]): TokenStats {
  const input    = entries.reduce((s, e) => s + e.input,    0);
  const output   = entries.reduce((s, e) => s + e.output,   0);
  const total    = input + output;
  const advisors = entries.reduce((s, e) => s + e.advisors, 0);
  const cost_usd = (input / 1e6) * INPUT_CPM + (output / 1e6) * OUTPUT_CPM;

  const dayMap = new Map<string, number>();
  for (const e of entries) {
    const d = e.ts.slice(0, 10);
    dayMap.set(d, (dayMap.get(d) ?? 0) + e.input + e.output);
  }
  const by_day = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  return { input, output, total, cost_usd, jobs: entries.length, advisors, by_day };
}

export async function queryStats(from: string, to: string, clientId?: string): Promise<TokenStats> {
  if (dbEnabled) {
    const params: unknown[] = [from, to];
    let where = `ts::date >= $1 AND ts::date <= $2`;
    if (clientId) { params.push(clientId); where += ` AND client_id = $3`; }
    const { rows } = await pool!.query(
      `SELECT ts, job_id, client_id, input, output, advisors
       FROM ${TOKEN_LOG_TABLE} WHERE ${where}`,
      params,
    );
    const entries: TokenEntry[] = rows.map(r => ({
      ts:        new Date(r.ts).toISOString(),
      job_id:    r.job_id,
      client_id: r.client_id,
      input:     r.input,
      output:    r.output,
      advisors:  r.advisors,
    }));
    return aggregate(entries);
  }

  const entries = loadFromFile().filter(e => {
    const d = e.ts.slice(0, 10);
    return d >= from && d <= to && (!clientId || e.client_id === clientId);
  });
  return aggregate(entries);
}

/**
 * One-time seed: if the token_log table is empty but the legacy token_log.json
 * file has entries, copy them in. Runs automatically at startup.
 */
export async function seedTokenLogFromFileIfEmpty(): Promise<void> {
  if (!dbEnabled) return;
  const { rows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM ${TOKEN_LOG_TABLE}`);
  if ((rows[0].n as number) > 0) return;
  const fromFile = loadFromFile();
  if (fromFile.length === 0) return;
  for (const e of fromFile) {
    await pool!.query(
      `INSERT INTO ${TOKEN_LOG_TABLE} (ts, job_id, client_id, input, output, advisors)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.ts, e.job_id, e.client_id, e.input, e.output, e.advisors],
    );
  }
  console.log(`[tokens] Seeded ${fromFile.length} token log entr(ies) from token_log.json into Postgres`);
}
