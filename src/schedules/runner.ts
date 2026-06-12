import { listSchedules, markRan, type Schedule } from './store';
import { loadClients } from '../clients/manager';
import { getCallData } from '../google/sheets';
import { createJob } from '../jobs/store';
import { runJob } from '../jobs/runner';

// ── Timezone helpers ──────────────────────────────────────────────────────────

interface TzNow {
  dateStr: string;   // YYYY-MM-DD
  hour:    number;
  minute:  number;
  day:     number;   // 0=Sun 1=Mon … 6=Sat
}

function getNowInTz(tz: string): TzNow {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('sv-SE',   { timeZone: tz });           // "2026-06-12"
  const timeStr = now.toLocaleTimeString('sv-SE',   { timeZone: tz, hour12: false }); // "14:30:00"
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

  // Days back to reach THIS week's Monday (day=0 → Sunday needs 6 back)
  const daysToMonday = day === 0 ? 6 : day - 1;
  const base = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC to avoid DST edge cases

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
  const d = new Date(Date.UTC(y, m - 2, 1)); // first day of previous month
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;
}

// ── Due-check ─────────────────────────────────────────────────────────────────

function isDue(schedule: Schedule): boolean {
  if (!schedule.enabled) return false;

  let now: TzNow;
  try { now = getNowInTz(schedule.timezone || 'America/Mexico_City'); }
  catch { return false; }

  if (now.hour !== schedule.hour || now.minute !== schedule.minute) return false;

  if (schedule.frequency === 'weekly'  && now.day  !== (schedule.day_of_week  ?? 1)) return false;
  if (schedule.frequency === 'monthly' && parseInt(now.dateStr.slice(8)) !== (schedule.day_of_month ?? 1)) return false;

  // Not already run today
  if (schedule.last_run && schedule.last_run.slice(0, 10) === now.dateStr) return false;

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
  let month:      string;
  let periodType: 'monthly' | 'weekly';
  let dateFrom:   string | undefined;
  let dateTo:     string | undefined;

  if (schedule.frequency === 'weekly') {
    const range = lastWeekRange(tz);
    month = range.month; periodType = 'weekly'; dateFrom = range.dateFrom; dateTo = range.dateTo;
  } else {
    month = lastMonthKey(tz); periodType = 'monthly';
  }

  // Resolve advisor list
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

  console.log(`[scheduler] Job ${job.id} created for '${schedule.name}'`);
  runJob(job).catch(err =>
    console.error(`[scheduler] Job ${job.id} for '${schedule.name}' failed:`, (err as Error).message),
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

let _interval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (_interval) return;
  console.log('[scheduler] Started — checking every 60 s');

  const check = async () => {
    for (const s of listSchedules()) {
      if (isDue(s)) {
        fireSchedule(s).catch(e =>
          console.error(`[scheduler] Error firing '${s.name}':`, (e as Error).message),
        );
      }
    }
  };

  _interval = setInterval(check, 60_000);
}

export function stopScheduler(): void {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
