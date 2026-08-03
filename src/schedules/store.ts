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
  frequency:     'weekly' | 'monthly' | 'once' | 'daily' | 'biweekly';
  // Qué genera esta automatización cuando NO es 'notify_only':
  //   'analisis' (default/legacy) → reporte de Análisis de Llamadas (individual + general)
  //   'radar'                     → Radar de Objeciones (archivo aparte, sin asesores)
  report_kind?:  'analisis' | 'radar';
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
  include_radar?:  boolean;   // genera además el Radar de Objeciones (solo frecuencia mensual)
  // 'all' = todo el roster · 'active' = solo quienes tuvieron llamadas en el
  // periodo · lista = nombres fijos. El [] legacy se lee como 'active'.
  advisors:      'all' | 'active' | string[];
  notify_only?:   boolean;   // skip report, just send Chat message
  chat_space_id?: string;    // Google Chat space, e.g. "spaces/AAAA"
  chat_message?:  string;    // message template with {{variables}}
  error_notify_enabled?: boolean;  // notify a Google Chat space when this automation fails
  error_chat_space_id?:  string;   // "spaces/AAAA..." target for error notifications
  created_at:    string;
  last_run?:     string;   // timestamp of the last SUCCESSFUL fire
  last_attempt?: string;   // timestamp of the last fire attempt (success or failure)
  last_status?:  'ok' | 'error';   // health of the last attempt
  last_error?:   string | null;    // failure detail when last_status === 'error'
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

// Registra que la automatización se DISPARÓ. Es lo único que puede afirmarse en
// ese momento: el job corre después y puede tardar minutos. El guard de "ya
// corrió hoy" mira este campo, así que un reinicio a mitad del job no provoca
// una tormenta de reintentos, pero tampoco deja el estado en verde mintiendo.
export async function markAttempt(id: string): Promise<void> {
  await updateSchedule(id, { last_attempt: new Date().toISOString() });
}

// Registra el ÉXITO: el job termino y entregó. Solo aquí se mueve `last_run`,
// que es lo que la UI muestra como "Último".
export async function markRan(id: string): Promise<void> {
  const now = new Date().toISOString();
  await updateSchedule(id, { last_run: now, last_attempt: now, last_status: 'ok', last_error: null });
}

// Records a failed fire so the UI can show a red health indicator. Deliberately
// does NOT touch last_run (which marks the last SUCCESS) nor the scheduler's
// "already ran today" guard, so a transient failure can still be retried.
export async function markFailed(id: string, error: string): Promise<void> {
  await updateSchedule(id, {
    last_attempt: new Date().toISOString(),
    last_status:  'error',
    last_error:   errorDetail(error),
  });
}

// Cómo se guarda un error: recortado, con texto por defecto si viene vacío.
// Comparar contra `last_error` exige pasar por aquí, o un error de 501 caracteres
// nunca se reconocería como repetido.
export function errorDetail(error: string): string {
  return (error || 'Error desconocido').slice(0, 500);
}

// ¿Este fallo es el mismo que el anterior? Lo usa el aviso de Chat para mandar
// un recordatorio corto en vez de repetir el error completo día tras día.
export function isRepeatError(
  schedule: Pick<Schedule, 'last_status' | 'last_error'>,
  error: string,
): boolean {
  return schedule.last_status === 'error' &&
    !!schedule.last_error &&
    schedule.last_error === errorDetail(error);
}

// Cómo hay que resolver `advisors` al disparar. La lista vacía es el caso
// delicado: la UI la escribía para "solo los que tuvieron llamadas", pero el
// runner la leía como "no hay nadie" y la automatización fallaba siempre.
export function advisorMode(advisors: Schedule['advisors']): 'explicit' | 'all' | 'active' {
  if (Array.isArray(advisors)) return advisors.length > 0 ? 'explicit' : 'active';
  return advisors === 'all' ? 'all' : 'active';
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
