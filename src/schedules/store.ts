import fs from 'fs';
import crypto from 'crypto';
import { SCHEDULES_FILE } from '../config/paths';
import {
  dbEnabled,
  SCHEDULES_TABLE,
  dbLoadAll,
  dbGet,
  dbUpsert,
  dbDelete,
  dbCount,
} from '../config/db';

export interface Schedule {
  id:            string;
  name:          string;
  client_id:     string;
  enabled:       boolean;
  frequency:     'weekly' | 'monthly' | 'once';
  day_of_week?:  number;   // 0=Sun 1=Mon … 6=Sat  (weekly)
  day_of_month?: number;   // 1-28                  (monthly)
  run_date?:     string;   // YYYY-MM-DD             (once) — WHEN it executes
  // For a one-time run, the modality + exact period it should analyse:
  once_mode?:      'weekly' | 'monthly';
  once_month?:     string;  // YYYY-MM     (once + monthly)
  once_date_from?: string;  // YYYY-MM-DD  (once + weekly, Monday)
  once_date_to?:   string;  // YYYY-MM-DD  (once + weekly, Sunday)
  hour:          number;   // 0-23
  minute:        number;   // 0-59
  timezone:      string;
  report_type:   'selected' | 'general';
  include_general: boolean;
  advisors:      'all' | string[];
  notify_only?:   boolean;   // skip report, just send Chat message
  chat_space_id?: string;    // Google Chat space, e.g. "spaces/AAAA"
  chat_message?:  string;    // message template with {{variables}}
  error_notify_enabled?: boolean;  // notify a Google Chat space when this automation fails
  error_chat_space_id?:  string;   // "spaces/AAAA..." target for error notifications
  created_at:    string;
  last_run?:     string;
}

// ── File fallback (used only when DATABASE_URL is not set) ───────────────────
function loadFromFile(): Schedule[] {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8')); }
  catch { return []; }
}

function saveToFile(schedules: Schedule[]): void {
  try { fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules), 'utf-8'); }
  catch (e) { console.warn('[schedules] persist failed:', (e as Error).message); }
}

// ── Public API (async: Postgres when DATABASE_URL is set, else JSON file) ────

export async function listSchedules(): Promise<Schedule[]> {
  if (dbEnabled) return dbLoadAll<Schedule>(SCHEDULES_TABLE);
  return loadFromFile();
}

export async function getSchedule(id: string): Promise<Schedule | undefined> {
  if (dbEnabled) return dbGet<Schedule>(SCHEDULES_TABLE, id);
  return loadFromFile().find(s => s.id === id);
}

export async function createSchedule(data: Omit<Schedule, 'id' | 'created_at'>): Promise<Schedule> {
  const schedule: Schedule = { ...data, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  if (dbEnabled) {
    await dbUpsert(SCHEDULES_TABLE, schedule.id, schedule);
  } else {
    const schedules = loadFromFile();
    schedules.push(schedule);
    saveToFile(schedules);
  }
  return schedule;
}

export async function updateSchedule(
  id: string,
  patch: Partial<Omit<Schedule, 'id' | 'created_at'>>,
): Promise<Schedule> {
  if (dbEnabled) {
    const existing = await dbGet<Schedule>(SCHEDULES_TABLE, id);
    if (!existing) throw new Error(`Schedule '${id}' not found`);
    const updated: Schedule = { ...existing, ...patch, id, created_at: existing.created_at };
    await dbUpsert(SCHEDULES_TABLE, id, updated);
    return updated;
  }
  const schedules = loadFromFile();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule '${id}' not found`);
  schedules[idx] = { ...schedules[idx], ...patch, id, created_at: schedules[idx].created_at };
  saveToFile(schedules);
  return schedules[idx];
}

export async function deleteSchedule(id: string): Promise<void> {
  if (dbEnabled) {
    await dbDelete(SCHEDULES_TABLE, id);
    return;
  }
  const schedules = loadFromFile();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule '${id}' not found`);
  schedules.splice(idx, 1);
  saveToFile(schedules);
}

export async function markRan(id: string): Promise<void> {
  await updateSchedule(id, { last_run: new Date().toISOString() });
}

/**
 * One-time seed: if the database has no schedules yet but the legacy
 * schedules.json file has entries, copy them in. Runs automatically at startup.
 */
export async function seedSchedulesFromFileIfEmpty(): Promise<void> {
  if (!dbEnabled) return;
  if ((await dbCount(SCHEDULES_TABLE)) > 0) return;
  const fromFile = loadFromFile();
  if (fromFile.length === 0) return;
  for (const schedule of fromFile) {
    if (!schedule.id) continue;
    await dbUpsert(SCHEDULES_TABLE, schedule.id, schedule);
  }
  console.log(`[schedules] Seeded ${fromFile.length} schedule(s) from schedules.json into Postgres`);
}
