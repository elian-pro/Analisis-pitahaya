import fs from 'fs';
import { TOKEN_FILE } from '../config/paths';

interface TokenEntry {
  ts:        string;   // ISO timestamp
  job_id:    string;
  client_id: string;
  input:     number;
  output:    number;
  advisors:  number;
}

function load(): TokenEntry[] {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')); }
  catch { return []; }
}

function persist(entries: TokenEntry[]): void {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(entries), 'utf-8'); }
  catch (e) { console.warn('[tokens] persist failed:', (e as Error).message); }
}

export function recordTokens(
  job_id:    string,
  client_id: string,
  input:     number,
  output:    number,
  advisors:  number,
): void {
  const entries = load();
  entries.push({ ts: new Date().toISOString(), job_id, client_id, input, output, advisors });
  persist(entries);
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

export function queryStats(from: string, to: string, clientId?: string): TokenStats {
  const entries = load().filter(e => {
    const d = e.ts.slice(0, 10);
    return d >= from && d <= to && (!clientId || e.client_id === clientId);
  });

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
