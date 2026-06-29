import crypto from 'crypto';
import { supabase, SCHEDULES_TABLE } from '../config/supabase';

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

// Each row stores the full schedule object in a `data` jsonb column keyed by `id`.
export async function listSchedules(): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from(SCHEDULES_TABLE)
    .select('data')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Supabase listSchedules failed: ${error.message}`);
  return (data ?? []).map(r => r.data as Schedule);
}

export async function getSchedule(id: string): Promise<Schedule | undefined> {
  const { data, error } = await supabase
    .from(SCHEDULES_TABLE)
    .select('data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Supabase getSchedule failed: ${error.message}`);
  return data ? (data.data as Schedule) : undefined;
}

export async function createSchedule(
  input: Omit<Schedule, 'id' | 'created_at'>,
): Promise<Schedule> {
  const schedule: Schedule = {
    ...input,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from(SCHEDULES_TABLE)
    .insert({ id: schedule.id, data: schedule });
  if (error) throw new Error(`Supabase createSchedule failed: ${error.message}`);
  return schedule;
}

export async function updateSchedule(
  id: string,
  patch: Partial<Omit<Schedule, 'id' | 'created_at'>>,
): Promise<Schedule> {
  const existing = await getSchedule(id);
  if (!existing) throw new Error(`Schedule '${id}' not found`);
  const updated: Schedule = { ...existing, ...patch, id, created_at: existing.created_at };
  const { error } = await supabase
    .from(SCHEDULES_TABLE)
    .update({ data: updated, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Supabase updateSchedule failed: ${error.message}`);
  return updated;
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase.from(SCHEDULES_TABLE).delete().eq('id', id);
  if (error) throw new Error(`Supabase deleteSchedule failed: ${error.message}`);
}

export async function markRan(id: string): Promise<void> {
  await updateSchedule(id, { last_run: new Date().toISOString() });
}
