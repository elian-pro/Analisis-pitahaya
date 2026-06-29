import { listSchedules, markRan, updateSchedule, type Schedule } from './store';
import { loadClients } from '../clients/manager';
import { getCallData } from '../google/sheets';
import { createJob, getJob } from '../jobs/store';
import { runJob } from '../jobs/runner';
import { sendChatMessage } from '../google/chat';

// ── Timezone helpers ──────────────────────────────────────────────────────────

interface TzNow {
  dateStr: string;   // YYYY-MM-DD
  hour:    number;
  minute:  number;
  day:     number;   // 0=Sun 1=Mon … 6=Sat
}

function getNowInTz(tz: string): TzNow {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('sv-SE',   { timeZone: tz });
  const timeStr = now.toLocaleTimeString('sv-SE',   { timeZone: tz, hour12: false });
  const wdStr   = new Intl.DateTimeFormat('en-US',  { timeZone: tz, weekday: 'short' }).format(now);

  const [hour, minute] = timeStr.split(':').map(Number);
  const DOW: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

  return { dateStr, hour, minute, day: DOW[wdStr] ?? 0 };
}

const pad = (n: number) => String(n).padStart(2, '0');

// "Last week" = the Monday–Sunday that ended before today
function lastWeekRange(tz: string): { dateFrom: string; dateTo: string; month: string } {
  const { dateStr, day } = getNowInTz(tz);
  const [y, m, d] = dateStr.split('-').map(Number);

  const daysToMonday = day === 0 ? 6 : day - 1;
  const base = new Date(Date.UTC(y, m - 1, d, 12));

  const thisMon  = new Date(base); thisMon.setUTCDate(base.getUTCDate() - daysToMonday);
  const lastMon  = new Date(thisMon); lastMon.setUTCDate(thisMon.getUTCDate() - 7);
  const lastSun  = new Date(lastMon); lastSun.setUTCDate(lastMon.getUTCDate() + 6);

  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`;

  return {
    dateFrom: fmt(lastMon),
    dateTo:   fmt(lastSun),
    month:    `${lastMon.getUTCFullYear()}-${pad(lastMon.getUTCMonth()+1)}`,
  };
}

function lastMonthKey(tz: string): string {
  const { dateStr } = getNowInTz(tz);
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;
}

// ── Chat notification ─────────────────────────────────────────────────────────

function buildChatMessage(
  template: string,
  vars: { nombre_cliente: string; periodo: string; link: string; nombre: string },
): string {
  return template
    .replace(/\{\{nombre_cliente\}\}/g, vars.nombre_cliente)
    .replace(/\{\{periodo\}\}/g,        vars.periodo)
    .replace(/\{\{link\}\}/g,           vars.link)
    .replace(/\{\{nombre\}\}/g,         vars.nombre);
}

async function notifyChat(
  schedule: Schedule,
  clientName: string,
  periodo: string,
  reportUrl: string,
): Promise<void> {
  if (!schedule.chat_space_id) return;

  const defaultTpl = '📊 *Reporte listo*: {{nombre_cliente}} | {{periodo}}\n🔗 {{link}}';
  const tpl = schedule.chat_message?.trim() || defaultTpl;
  const text = buildChatMessage(tpl, {
    nombre_cliente: clientName,
    periodo,
    link:  reportUrl,
    nombre: schedule.name,
  });

  try {
    await sendChatMessage(schedule.chat_space_id, text);
    console.log(`[scheduler] Chat notification sent for '${schedule.name}'`);
  } catch (e) {
    console.error(`[scheduler] Chat notification failed for '${schedule.name}':`, (e as Error).message);
  }
}

// ── Due-check ─────────────────────────────────────────────────────────────────

// Convert a stored UTC ISO timestamp to a YYYY-MM-DD date string in the given tz,
// so "already ran today" is judged in the schedule's own timezone (not UTC).
function dateStrInTz(iso: string, tz: string): string {
  try { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: tz }); }
  catch { return iso.slice(0, 10); }
}

function isDue(schedule: Schedule): boolean {
  if (!schedule.enabled) return false;

  const tz = schedule.timezone || 'America/Mexico_City';
  let now: TzNow;
  try { now = getNowInTz(tz); }
  catch { return false; }

  // Must be the right day for this frequency
  if (schedule.frequency === 'weekly'  && now.day  !== (schedule.day_of_week  ?? 1)) return false;
  if (schedule.frequency === 'monthly' && parseInt(now.dateStr.slice(8)) !== (schedule.day_of_month ?? 1)) return false;
  if (schedule.frequency === 'once'    && now.dateStr !== (schedule.run_date ?? '')) return false;

  // Already ran today (judged in the schedule's timezone)? Skip.
  if (schedule.last_run && dateStrInTz(schedule.last_run, tz) === now.dateStr) return false;

  // Catch-up semantics: fire once the scheduled time has ARRIVED OR PASSED today,
  // not only at the exact target minute. This survives deploys, restarts, and
  // event-loop delays that would otherwise skip the single target minute for the
  // whole day. The "already ran today" guard above keeps it to one run per day.
  const schedMinutes = schedule.hour * 60 + schedule.minute;
  const nowMinutes   = now.hour * 60 + now.minute;
  if (nowMinutes < schedMinutes) return false;

  return true;
}

// ── Fire a schedule ───────────────────────────────────────────────────────────

async function fireSchedule(schedule: Schedule): Promise<void> {
  console.log(`[scheduler] Firing '${schedule.name}' (${schedule.id})`);

  const client = loadClients().find(c => c.id === schedule.client_id);
  if (!client) {
    console.error(`[scheduler] Client '${schedule.client_id}' not found — skipping`);
    return;
  }

  const tz = schedule.timezone || 'America/Mexico_City';

  // ── Notify-only mode: just send a Chat message ────────────────────────────
  if (schedule.notify_only) {
    markRan(schedule.id);
    if (schedule.frequency === 'once') updateSchedule(schedule.id, { enabled: false });
    await notifyChat(schedule, client.name, getNowInTz(tz).dateStr, '');
    return;
  }

  // ── Determine period ──────────────────────────────────────────────────────
  let month:      string;
  let periodType: 'monthly' | 'weekly';
  let dateFrom:   string | undefined;
  let dateTo:     string | undefined;
  let periodLabel: string;

  if (schedule.frequency === 'weekly') {
    const range = lastWeekRange(tz);
    month = range.month; periodType = 'weekly'; dateFrom = range.dateFrom; dateTo = range.dateTo;
    periodLabel = `${dateFrom} — ${dateTo}`;
  } else if (schedule.frequency === 'once') {
    // For a one-time run, analyse the current month up to today
    const now2 = getNowInTz(tz);
    month = now2.dateStr.slice(0, 7); periodType = 'monthly';
    periodLabel = month;
  } else {
    month = lastMonthKey(tz); periodType = 'monthly';
    periodLabel = month;
  }

  // ── Resolve advisor list ──────────────────────────────────────────────────
  let advisors: string[];
  if (schedule.advisors === 'all') {
    try {
      const cols = {
        fecha: client.col_fecha, asesor: client.col_asesor, calif: client.col_calif,
        analisis: client.col_analisis, transcripcion: client.col_transcripcion,
        duracion: client.col_duracion,
      };
      const calls = await getCallData(
        client.spreadsheet_id, client.data_sheet_name, cols,
        month, client.excluded_phrases, client.transcripcion_max_chars,
        dateFrom, dateTo,
      );
      advisors = [...new Set(calls.map(c => c.asesor))].filter(Boolean);
    } catch (e) {
      console.error(`[scheduler] Failed to fetch advisors for '${schedule.name}':`, (e as Error).message);
      return;
    }
  } else {
    advisors = schedule.advisors;
  }

  if (advisors.length === 0) {
    console.warn(`[scheduler] No advisors in period for '${schedule.name}' — skipping`);
    return;
  }

  const reportType = schedule.report_type === 'general' ? 'general'
    : (schedule.include_general ? 'general' : 'selected');

  const job = createJob(schedule.client_id, month, reportType, advisors, periodType, dateFrom, dateTo);
  markRan(schedule.id);
  if (schedule.frequency === 'once') updateSchedule(schedule.id, { enabled: false });

  console.log(`[scheduler] Job ${job.id} created for '${schedule.name}'`);

  runJob(job)
    .then(async () => {
      if (!schedule.chat_space_id) return;
      const done = getJob(job.id);
      const url = done?.results?.combined?.driveUrl
        ?? done?.results?.individual?.[0]?.driveUrl
        ?? '';
      await notifyChat(schedule, client.name, periodLabel, url);
    })
    .catch(err =>
      console.error(`[scheduler] Job ${job.id} for '${schedule.name}' failed:`, (err as Error).message),
    );
}

// ── Public API ────────────────────────────────────────────────────────────────

let _interval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (_interval) return;
  console.log('[scheduler] Started — checking every 60 s (catch-up enabled)');

  const check = async () => {
    for (const s of listSchedules()) {
      let due = false;
      try { due = isDue(s); }
      catch (e) { console.error(`[scheduler] isDue error for '${s.name}':`, (e as Error).message); }
      if (due) {
        fireSchedule(s).catch(e =>
          console.error(`[scheduler] Error firing '${s.name}':`, (e as Error).message),
        );
      }
    }
  };

  // Run one check immediately so a fresh start catches up any run already due
  // today (e.g. a deploy that spanned the scheduled minute).
  check().catch(e => console.error('[scheduler] initial check error:', (e as Error).message));
  _interval = setInterval(check, 60_000);
}

export function stopScheduler(): void {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
