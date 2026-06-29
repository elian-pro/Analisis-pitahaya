import fs from 'fs';
import crypto from 'crypto';
import { SCHEDULES_FILE } from '../config/paths';

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


function load(): Schedule[] {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8')); }
  catch { return []; }
}

function persist(schedules: Schedule[]): void {
  try { fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules), 'utf-8'); }
  catch (e) { console.warn('[schedules] persist failed:', (e as Error).message); }
}

export function listSchedules(): Schedule[] { return load(); }

export function getSchedule(id: string): Schedule | undefined {
  return load().find(s => s.id === id);
}

export function createSchedule(data: Omit<Schedule, 'id' | 'created_at'>): Schedule {
  const schedules = load();
  const schedule: Schedule = { ...data, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  schedules.push(schedule);
  persist(schedules);
  return schedule;
}

export function updateSchedule(id: string, patch: Partial<Omit<Schedule, 'id' | 'created_at'>>): Schedule {
  const schedules = load();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule '${id}' not found`);
  schedules[idx] = { ...schedules[idx], ...patch };
  persist(schedules);
  return schedules[idx];
}

export function deleteSchedule(id: string): void {
  const schedules = load();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) throw new Error(`Schedule '${id}' not found`);
  schedules.splice(idx, 1);
  persist(schedules);
}

export function markRan(id: string): void {
  updateSchedule(id, { last_run: new Date().toISOString() });
}
