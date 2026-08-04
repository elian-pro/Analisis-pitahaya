import { listSchedules, getSchedule, markAttempt, markRan, markFailed, isRepeatError, errorDetail, advisorMode, updateSchedule, type Schedule } from './store';

// Result of a single fire attempt's SYNCHRONOUS phase (advisor read + job
// enqueue). The report job itself runs asynchronously afterwards; its outcome
// is reflected later via the schedule's health status, not this return value.
export interface FireResult { ok: boolean; job_id?: string; error?: string }
import { loadClients } from '../clients/manager';
import { listAdvisors, seedAdvisorsFromSheetIfNeeded } from '../advisors/store';
import { getAdvisorNamesWithCalls } from '../google/sheets';
import { createJob, getJob } from '../jobs/store';
import { runJob } from '../jobs/runner';
import { sendChatMessage } from '../google/chat';
import { monthLabel, weekLabel } from '../google/drive';
import { runRadarForClient, runRadarForClientFortnight, fortnightForRun, type RadarDbResult } from '../radar/dbFlow';
import { env } from '../config/env';

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

type ReportKind = 'analisis' | 'radar';

const KIND_LABEL: Record<ReportKind, string> = {
  analisis: 'Análisis de Llamadas',
  radar:    'Radar de Objeciones',
};

// Cada tipo de reporte se anuncia distinto para distinguirlos de un vistazo en
// un canal con muchos mensajes. Se usan solo si la automatización no trae un
// `chat_message` propio.
const DEFAULT_TPL: Record<ReportKind, string> = {
  analisis: '📊 *Análisis de Llamadas* · {{periodicidad}}\n{{nombre_cliente}} · {{periodo}}\n🔗 {{link}}',
  radar:    '📡 *Radar de Objeciones* · {{periodicidad}}\n{{nombre_cliente}} · {{periodo}}\n🔗 {{link}}',
};

// Con qué cadencia corre. Para 'once' lo informativo no es "una sola vez" sino
// la modalidad del periodo que analiza, que es lo que el lector compara.
function periodicityLabel(schedule: Schedule): string {
  switch (schedule.frequency) {
    case 'weekly':   return 'Semanal';
    case 'monthly':  return 'Mensual';
    case 'biweekly': return 'Quincenal';
    case 'daily':    return 'Diario';
    case 'once':     return schedule.once_mode === 'weekly' ? 'Semanal' : 'Mensual';
    default:         return '';
  }
}

function buildChatMessage(
  template: string,
  vars: { nombre_cliente: string; periodo: string; link: string; nombre: string; tipo: string; periodicidad: string },
): string {
  return template
    .replace(/\{\{nombre_cliente\}\}/g, vars.nombre_cliente)
    .replace(/\{\{periodo\}\}/g,        vars.periodo)
    .replace(/\{\{link\}\}/g,           vars.link)
    .replace(/\{\{nombre\}\}/g,         vars.nombre)
    .replace(/\{\{tipo\}\}/g,           vars.tipo)
    .replace(/\{\{periodicidad\}\}/g,   vars.periodicidad);
}

async function notifyChat(
  schedule: Schedule,
  clientName: string,
  periodo: string,
  reportUrl: string,
  kind: ReportKind,
  // El Radar adjunto a un reporte de análisis va en su propio mensaje: usar ahí
  // el `chat_message` del usuario lo anunciaría como si fuera el análisis.
  ignoreCustomTemplate = false,
): Promise<void> {
  if (!schedule.chat_space_id) return;

  const tpl = (ignoreCustomTemplate ? '' : schedule.chat_message?.trim()) || DEFAULT_TPL[kind];
  const text = buildChatMessage(tpl, {
    nombre_cliente: clientName,
    periodo,
    link:  reportUrl,
    nombre: schedule.name,
    tipo:  KIND_LABEL[kind],
    periodicidad: periodicityLabel(schedule),
  });

  try {
    await sendChatMessage(schedule.chat_space_id, text);
    console.log(`[scheduler] Chat notification sent for '${schedule.name}'`);
  } catch (e) {
    console.error(`[scheduler] Chat notification failed for '${schedule.name}':`, (e as Error).message);
  }
}

// Sends a Google Chat alert to the schedule's configured error space when the
// automation fails. No-op unless the schedule enabled error notifications.
async function notifyError(
  schedule: Schedule,
  clientName: string,
  periodo: string,
  raw: string,
): Promise<void> {
  if (!schedule.error_notify_enabled || !schedule.error_chat_space_id) return;

  // Mismo texto que guarda markFailed (traducido y recortado): así el aviso y la
  // tarjeta dicen lo mismo, y la comparación de "error repetido" cuadra.
  const detail = errorDetail(raw);

  // ¿Es el MISMO error que la vez pasada? `schedule` es el objeto cargado al
  // inicio del disparo y markFailed() no lo muta, así que `last_error` todavía
  // guarda el fallo anterior.
  const repeat = isRepeatError(schedule, detail);

  const appUrl = env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  const link   = appUrl ? `\n🔗 Ver detalles: ${appUrl}/#automation` : '';

  const text = repeat
    ? `🔁 *Recuerda que tienes un error en la automatización*\n` +
      `Cliente: ${clientName}\n` +
      `Automatización: ${schedule.name}\n` +
      `Sigue fallando por lo mismo: ${detail}` + link
    : `⚠️ *Error en automatización*\n` +
      `Cliente: ${clientName}\n` +
      `Automatización: ${schedule.name}\n` +
      `Periodo: ${periodo}\n` +
      `Detalle: ${detail}` + link;

  try {
    await sendChatMessage(schedule.error_chat_space_id, text);
    console.log(`[scheduler] Error notification sent for '${schedule.name}'`);
  } catch (e) {
    console.error(`[scheduler] Error notification FAILED for '${schedule.name}':`, (e as Error).message);
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

  // Ya hay un disparo en vuelo: el tick de 60 s no debe encimar otro. Sin esto,
  // una fase lenta previa a markAttempt (leer el roster del Sheet) deja el guard
  // de "ya intentó hoy" desactualizado y el scheduler dispara —y avisa— cada minuto.
  if (_running.has(schedule.id)) return false;

  const tz = schedule.timezone || 'America/Mexico_City';
  let now: TzNow;
  try { now = getNowInTz(tz); }
  catch { return false; }

  // Must be the right day for this frequency
  if (schedule.frequency === 'weekly'  && now.day  !== (schedule.day_of_week  ?? 1)) return false;
  if (schedule.frequency === 'monthly' && parseInt(now.dateStr.slice(8)) !== (schedule.day_of_month ?? 1)) return false;
  if (schedule.frequency === 'once'    && now.dateStr !== (schedule.run_date ?? '')) return false;
  // Quincenal: corre el día 1 (2ª quincena del mes anterior) y el 16 (1ª del mes actual).
  if (schedule.frequency === 'biweekly') {
    const dom = parseInt(now.dateStr.slice(8));
    if (dom !== 1 && dom !== 16) return false;
  }
  // 'daily' no tiene filtro de día: corre todos los días (sujeto a hora + 1×/día).

  // Already ran today (judged in the schedule's timezone)? Skip.
  if (schedule.last_attempt && dateStrInTz(schedule.last_attempt, tz) === now.dateStr) return false;

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

// In-memory set of schedule ids with an in-flight run. Exposed via GET
// /api/schedules as `running: true` so the UI can animate the card for BOTH
// manual and automatic fires. In-memory on purpose: a process restart clears it,
// so a crash mid-run can never leave a card stuck "running".
const _running = new Set<string>();
export function runningScheduleIds(): Set<string> { return _running; }

// Marca el intento y suelta el flag pase lo que pase: si una excepción escapara
// del cuerpo, el id quedaría en `_running` y —ahora que isDue() lo consulta— la
// automatización no volvería a dispararse hasta reiniciar el proceso.
async function fireSchedule(schedule: Schedule): Promise<FireResult> {
  _running.add(schedule.id);
  // Antes que cualquier trabajo lento, para que el guard de "ya intentó hoy"
  // valga desde el primer segundo y no desde que termina de leer el Sheet.
  await markAttempt(schedule.id).catch(e =>
    console.error(`[scheduler] markAttempt failed for '${schedule.name}':`, (e as Error).message));
  try {
    return await fireScheduleInner(schedule);
  } catch (e) {
    _running.delete(schedule.id);
    throw e;
  }
}

async function fireScheduleInner(schedule: Schedule): Promise<FireResult> {
  console.log(`[scheduler] Firing '${schedule.name}' (${schedule.id})`);

  const client = (await loadClients()).find(c => c.id === schedule.client_id);
  if (!client) {
    const error = `Cliente '${schedule.client_id}' no encontrado.`;
    console.error(`[scheduler] ${error} — skipping`);
    await markFailed(schedule.id, error);
    _running.delete(schedule.id);
    return { ok: false, error };
  }

  const tz = schedule.timezone || 'America/Mexico_City';

  // ── Notify-only mode: just send a Chat message ────────────────────────────
  if (schedule.notify_only) {
    if (schedule.frequency === 'once') await updateSchedule(schedule.id, { enabled: false });
    await notifyChat(schedule, client.name, getNowInTz(tz).dateStr, '', 'analisis');
    await markRan(schedule.id);
    _running.delete(schedule.id);
    return { ok: true };
  }

  // ── Radar de Objeciones: su propia automatización (sin asesores, sin job) ──
  if (schedule.report_kind === 'radar') {
    let periodLabel: string;
    let radarRun: () => Promise<RadarDbResult>;

    if (schedule.frequency === 'biweekly') {
      const f = fortnightForRun(getNowInTz(tz).dateStr);
      periodLabel = f.periodLabel;
      radarRun = () => runRadarForClientFortnight(client, f);
    } else {
      // 'monthly' → mes anterior; 'once' (modo mensual) → el mes elegido.
      const month = (schedule.frequency === 'once' && schedule.once_month)
        ? schedule.once_month
        : lastMonthKey(tz);
      periodLabel = monthLabel(month);
      radarRun = () => runRadarForClient(client, month);
    }

    if (schedule.frequency === 'once') await updateSchedule(schedule.id, { enabled: false });
    console.log(`[scheduler] Radar run started for '${schedule.name}' (${periodLabel})`);

    radarRun()
      .then(async (res) => {
        await markRan(schedule.id);
        await notifyChat(schedule, client.name, periodLabel, res.driveUrl, 'radar');
      })
      .catch(async (err) => {
        console.error(`[scheduler] Radar for '${schedule.name}' failed:`, (err as Error).message);
        await markFailed(schedule.id, (err as Error).message);
        await notifyError(schedule, client.name, periodLabel, (err as Error).message);
      })
      .finally(() => { _running.delete(schedule.id); });

    return { ok: true };
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
    periodLabel = weekLabel(dateFrom, dateTo);
  } else if (schedule.frequency === 'once') {
    // A one-time run analyses the specific period the user chose.
    if (schedule.once_mode === 'weekly' && schedule.once_date_from && schedule.once_date_to) {
      periodType = 'weekly';
      dateFrom = schedule.once_date_from;
      dateTo   = schedule.once_date_to;
      month    = schedule.once_date_from.slice(0, 7);
      periodLabel = weekLabel(dateFrom, dateTo);
    } else if (schedule.once_mode === 'monthly' && schedule.once_month) {
      periodType = 'monthly';
      month = schedule.once_month;
      periodLabel = monthLabel(month);
    } else {
      // Backward-compatible fallback: current month up to today
      const now2 = getNowInTz(tz);
      month = now2.dateStr.slice(0, 7); periodType = 'monthly';
      periodLabel = monthLabel(month);
    }
  } else {
    month = lastMonthKey(tz); periodType = 'monthly';
    periodLabel = monthLabel(month);
  }

  // ── Resolve advisor list ──────────────────────────────────────────────────
  // 'all' means "every advisor in the client's CONFIGURED roster" (the
  // advisors table managed from the Reportes tab) — NOT every name that
  // happens to appear in the sheet's call data for the period. Reading names
  // from the sheet used to pull in advisors the team never enrolled (leads
  // misfiled in the advisor column, staff from other teams, etc.). The job
  // runner already skips roster advisors with no calls in the period, so no
  // call-data pre-check is needed here.
  //
  // 'active' = ese mismo roster, recortado a quienes SÍ tuvieron llamadas en el
  // periodo. Una lista vacía guardada significa lo mismo: es lo que la UI
  // escribía antes de que 'active' existiera, y reinterpretarla aquí evita
  // tener que reeditar a mano las automatizaciones ya creadas.
  const mode = advisorMode(schedule.advisors);
  const wantsActiveOnly = mode === 'active';

  let advisors: string[];
  let rosterSize = 0;
  if (mode === 'explicit') {
    advisors = schedule.advisors as string[];
  } else {
    try {
      await seedAdvisorsFromSheetIfNeeded(client);
      const roster = (await listAdvisors(client.id)).map(a => a.name);
      rosterSize = roster.length;

      if (wantsActiveOnly) {
        const withCalls = await getAdvisorNamesWithCalls(
          client.spreadsheet_id, client.data_sheet_name, client.col_fecha, client.col_asesor,
          month, dateFrom, dateTo,
        );
        advisors = roster.filter(name => withCalls.has(name));
      } else {
        advisors = roster;
      }
    } catch (e) {
      console.error(`[scheduler] Failed to resolve advisors for '${schedule.name}':`, (e as Error).message);
      const error = `No se pudo leer la lista de asesores: ${(e as Error).message}`;
      await markFailed(schedule.id, error);
      await notifyError(schedule, client.name, periodLabel, error);
      _running.delete(schedule.id);
      return { ok: false, error };
    }
  }

  if (advisors.length === 0) {
    // Tres causas distintas con arreglos distintos: decir siempre "agrega
    // asesores" mandaba a revisar un roster que muchas veces estaba completo.
    const error =
      rosterSize === 0
        ? 'El cliente no tiene asesores en el roster. Agrégalos en la pestaña Reportes, sección "Seleccionar asesores".'
        : wantsActiveOnly
          ? `Ningún asesor del roster (${rosterSize}) registró llamadas en ${periodLabel}. La automatización está configurada como "Solo los que tuvieron llamadas": revisa que el Sheet tenga llamadas de ese periodo y que los nombres coincidan con el roster.`
          : 'La automatización tiene una lista de asesores propia y está vacía. Edítala y elige "Todos los asesores" o "Solo los que tuvieron llamadas".';
    console.warn(`[scheduler] No advisors resolved for '${schedule.name}': ${error}`);
    await markFailed(schedule.id, error);
    await notifyError(schedule, client.name, periodLabel, error);
    _running.delete(schedule.id);
    return { ok: false, error };
  }

  const reportType = schedule.report_type === 'general' ? 'general'
    : (schedule.include_general ? 'general' : 'selected');

  // El Radar de Objeciones es MENSUAL: solo se propaga en automatizaciones mensuales.
  const includeRadar = schedule.include_radar === true && schedule.frequency === 'monthly';
  const job = createJob(schedule.client_id, month, reportType, advisors, periodType, dateFrom, dateTo, includeRadar);
  if (schedule.frequency === 'once') await updateSchedule(schedule.id, { enabled: false });

  console.log(`[scheduler] Job ${job.id} created for '${schedule.name}'`);

  runJob(job)
    .then(async () => {
      const done = getJob(job.id);

      // Report generation failed — alert the client's error space instead of
      // sending a "report ready" message.
      if (done?.status === 'error') {
        await markFailed(schedule.id, done.error || 'La generación del reporte falló.');
        await notifyError(schedule, client.name, periodLabel,
          done.error || 'La generación del reporte falló.');
        return;
      }

      await markRan(schedule.id);

      if (!schedule.chat_space_id) return;
      const url = done?.results?.combined?.driveUrl
        ?? done?.results?.individual?.[0]?.driveUrl
        ?? '';
      await notifyChat(schedule, client.name, periodLabel, url, 'analisis');

      // Si se generó el Radar de Objeciones (archivo aparte), avisa su link también.
      // Va con la plantilla de Radar aunque la automatización tenga una propia:
      // esa está escrita para el análisis y aquí anunciaría el PDF equivocado.
      const radarUrl = done?.results?.radar?.driveUrl;
      if (radarUrl) await notifyChat(schedule, client.name, periodLabel, radarUrl, 'radar', true);
    })
    .catch(async err => {
      console.error(`[scheduler] Job ${job.id} for '${schedule.name}' failed:`, (err as Error).message);
      await markFailed(schedule.id, (err as Error).message);
      await notifyError(schedule, client.name, periodLabel, (err as Error).message);
    })
    .finally(() => { _running.delete(schedule.id); });

  return { ok: true, job_id: job.id };
}

// Manually fire a schedule right now, bypassing the isDue() time/day gating.
// Used by the "Ejecutar ahora" action; works even if the schedule is paused.
export async function runScheduleNow(id: string): Promise<FireResult> {
  const schedule = await getSchedule(id);
  if (!schedule) throw new Error(`Schedule '${id}' not found`);
  console.log(`[scheduler] Manual run requested for '${schedule.name}' (${id})`);
  return fireSchedule(schedule);
}

// ── Public API ────────────────────────────────────────────────────────────────

let _interval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (_interval) return;
  console.log('[scheduler] Started — checking every 60 s (catch-up enabled)');

  const check = async () => {
    let schedules: Schedule[];
    try {
      schedules = await listSchedules();
    } catch (e) {
      console.error('[scheduler] Could not load schedules:', (e as Error).message);
      return;
    }
    for (const s of schedules) {
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
