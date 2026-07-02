import fs from 'fs';
import crypto from 'crypto';
import { ADVISORS_FILE } from '../config/paths';
import {
  dbEnabled,
  ADVISORS_TABLE,
  dbLoadAll,
  dbGet,
  dbUpsert,
  dbDelete,
} from '../config/db';
import { ClientConfig, updateClient } from '../clients/manager';
import { getAdvisors, getAdvisorsForMonth } from '../google/sheets';

// ─────────────────────────────────────────────────────────────────────────────
// Advisor roster per client, in Postgres (or JSON file fallback, same dual
// pattern as clients/manager.ts). Replaces two things that used to live only
// in the browser's localStorage (custom_advisors / hidden_advisors, per
// client, per browser, never synced across teammates): adding an advisor and
// removing one. Reading the roster from Sheets every time was also fragile
// (a column rename or an advisor with zero calls in a given month would just
// silently make them disappear from the picker) — now Sheets is only used
// once, to seed this table, and afterwards to check which advisors had calls
// in the selected period (a UI hint, not the source of truth for the roster).
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvisorRecord {
  id:        string;
  client_id: string;
  name:      string;
  initials:  string;
  bg:        string;
  color:     string;
  active:    boolean;
}

// Same 8-color palette the frontend has always cycled through for
// Sheets-derived advisors (index.html's `PC` constant) — mirrored here so
// seeded advisors get stable colors assigned once, not recomputed per render.
const PALETTE: Array<{ bg: string; color: string }> = [
  { bg: '#C0392B', color: '#ffffff' },
  { bg: '#1F6FA8', color: '#ffffff' },
  { bg: '#8E44AD', color: '#ffffff' },
  { bg: '#117A65', color: '#ffffff' },
  { bg: '#B9770E', color: '#ffffff' },
  { bg: '#2C3E80', color: '#ffffff' },
  { bg: '#C2185B', color: '#ffffff' },
  { bg: '#2E7D32', color: '#ffffff' },
];

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

// ── File fallback (used only when DATABASE_URL is not set) ───────────────────
function loadFromFile(): AdvisorRecord[] {
  try { return JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf-8')); }
  catch { return []; }
}

function saveToFile(advisors: AdvisorRecord[]): void {
  fs.writeFileSync(ADVISORS_FILE, JSON.stringify(advisors, null, 2), 'utf-8');
}

async function loadAll(): Promise<AdvisorRecord[]> {
  if (dbEnabled) return dbLoadAll<AdvisorRecord>(ADVISORS_TABLE);
  return loadFromFile();
}

// ── Public API (async: Postgres when DATABASE_URL is set, else JSON file) ────

export async function listAdvisors(
  clientId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<AdvisorRecord[]> {
  const all = (await loadAll()).filter(a => a.client_id === clientId);
  const list = opts.includeInactive ? all : all.filter(a => a.active);
  return list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function getAdvisor(id: string): Promise<AdvisorRecord | undefined> {
  if (dbEnabled) return dbGet<AdvisorRecord>(ADVISORS_TABLE, id);
  return loadFromFile().find(a => a.id === id);
}

export async function createAdvisor(
  clientId: string,
  data: { name: string; initials?: string; bg?: string; color?: string },
): Promise<AdvisorRecord> {
  const existingCount = (await loadAll()).filter(a => a.client_id === clientId).length;
  const palette = PALETTE[existingCount % PALETTE.length];
  const id = `adv_${crypto.randomBytes(4).toString('hex')}`;
  const advisor: AdvisorRecord = {
    id,
    client_id: clientId,
    name:      data.name.trim(),
    initials:  (data.initials?.trim().toUpperCase()) || makeInitials(data.name),
    bg:        data.bg    ?? palette.bg,
    color:     data.color ?? palette.color,
    active:    true,
  };
  if (dbEnabled) {
    await dbUpsert(ADVISORS_TABLE, id, advisor);
  } else {
    const advisors = loadFromFile();
    advisors.push(advisor);
    saveToFile(advisors);
  }
  return advisor;
}

export async function updateAdvisor(
  id: string,
  patch: Partial<Omit<AdvisorRecord, 'id' | 'client_id'>>,
): Promise<AdvisorRecord> {
  if (dbEnabled) {
    const existing = await dbGet<AdvisorRecord>(ADVISORS_TABLE, id);
    if (!existing) throw new Error(`Advisor '${id}' not found`);
    const updated: AdvisorRecord = { ...existing, ...patch, id, client_id: existing.client_id };
    await dbUpsert(ADVISORS_TABLE, id, updated);
    return updated;
  }
  const advisors = loadFromFile();
  const idx = advisors.findIndex(a => a.id === id);
  if (idx === -1) throw new Error(`Advisor '${id}' not found`);
  advisors[idx] = { ...advisors[idx], ...patch, id, client_id: advisors[idx].client_id };
  saveToFile(advisors);
  return advisors[idx];
}

export async function deleteAdvisor(id: string): Promise<void> {
  if (dbEnabled) {
    await dbDelete(ADVISORS_TABLE, id);
    return;
  }
  const advisors = loadFromFile();
  const idx = advisors.findIndex(a => a.id === id);
  if (idx === -1) throw new Error(`Advisor '${id}' not found`);
  advisors.splice(idx, 1);
  saveToFile(advisors);
}

/**
 * One-time import: the first time a client's roster is requested, pull
 * advisor names from Sheets (support sheet if configured, else the data
 * sheet for the current month) and create a DB/JSON row for each. Marks the
 * client as `advisors_seeded` regardless of how many names were found, so
 * this never runs again for that client — from then on the roster is fully
 * DB-owned and editable, matching the whole point of moving off Sheets.
 * Best-effort: a Sheets failure here must not block listAdvisors() from
 * returning whatever is already in the DB.
 */
export async function seedAdvisorsFromSheetIfNeeded(client: ClientConfig): Promise<void> {
  if (client.advisors_seeded) return;
  try {
    let names: string[] = [];
    if (client.advisors_sheet_name) {
      const rows = await getAdvisors(client.spreadsheet_id, client.advisors_sheet_name, client.col_asesor);
      names = rows.map(r => r.asesor);
    } else {
      const month = new Date().toISOString().slice(0, 7);
      const rows = await getAdvisorsForMonth(
        client.spreadsheet_id, client.data_sheet_name, client.col_fecha, client.col_asesor, month,
      );
      names = rows.map(r => r.asesor);
    }
    const uniqueNames = [...new Set(names.map(n => n.trim()).filter(Boolean))];
    for (const name of uniqueNames) {
      await createAdvisor(client.id, { name });
    }
    console.log(`[advisors] Seeded ${uniqueNames.length} advisor(s) for client '${client.id}' from Sheets`);
  } catch (e) {
    console.warn(`[advisors] Sheet import failed for client '${client.id}', starting with an empty roster:`, (e as Error).message);
  } finally {
    // Mark as seeded even on failure/empty result: this is a one-shot import,
    // not a sync — retrying it on every request would defeat moving off Sheets.
    await updateClient(client.id, { advisors_seeded: true });
  }
}
