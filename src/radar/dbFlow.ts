import { clientFileLabel, type ClientConfig } from '../clients/manager';
import { listAdvisors } from '../advisors/store';
import { rosterMatcher } from '../advisors/match';
import { readCalls } from '../calls/read';
import { monthLabel, previousMonth, uploadPdfNamed, radarFilename, findRadarSidecar, uploadRadarSidecar } from '../google/drive';
import { resolveRadarPrompt, type RadarCall, type RadarPeriodMeta } from '../claude/radar';
import { parseRadarSidecar } from './sidecar';
import { processRadarReport } from './process';
import type { RadarReportData } from '../schemas/radar';

// ─────────────────────────────────────────────────────────────────────────────
// Flujo del Radar desde la base de datos: un cliente + un período. Lee la hoja
// con el cap y umbral propios del Radar (default 8000 chars / 150 s), busca el
// sidecar del período anterior para el comparativo, genera el reporte, sube el
// PDF a la carpeta de Radar y persiste el sidecar. Lo usan el runner (scheduler)
// y el endpoint manual.
//
// Períodos soportados:
//   • Mensual  → runRadarForClient(client, 'YYYY-MM')          (period_key = mes)
//   • Quincenal→ runRadarForClientRange(client, {…})           (period_key = YYYY-MM-Q1|Q2)
// El comparativo compara contra el período inmediatamente anterior del mismo tipo.
// ─────────────────────────────────────────────────────────────────────────────

// 150 s y no 200: con 200, en el primer mes real de Midstorage entraban 26 de
// 44 llamadas y se quedaban fuera tres de 150-199 s que si tienen conversacion.
// Sigue siendo mas alto que el umbral del pipeline (100 s) a proposito: para
// leer objeciones hace falta dialogo, no un "no me interesa" de dos minutos.
export const RADAR_MIN_DURATION_DEFAULT = 150;
export const RADAR_MAX_CHARS_DEFAULT     = 8000;

// El Radar solo analiza las llamadas de los asesores dados de alta en el cliente:
// sin ese filtro, dos clientes que comparten hoja se contaminan el reporte y el
// PDF del equipo A se sube igual a la carpeta de Drive de A. Ver advisors/match.

function secondsToLabel(sec: number): string | undefined {
  if (!sec || sec <= 0) return undefined;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
}

export interface RadarDbResult {
  reportData:    RadarReportData;
  driveUrl:      string;
  pdfBuffer:     Buffer;
  input_tokens:  number;
  output_tokens: number;
}

// Descriptor de un período arbitrario a analizar (mensual o quincenal).
interface RadarPeriod {
  periodKey:     string;   // clave única del sidecar/nombre: 'YYYY-MM' o 'YYYY-MM-Q1'
  periodLabel:   string;   // etiqueta legible para el PDF
  dateFrom:      string;   // YYYY-MM-DD
  dateTo:        string;   // YYYY-MM-DD
  month:         string;   // YYYY-MM (para lectura por mes cuando aplica)
  useRange:      boolean;  // true → lee por rango de fechas; false → lee por mes
  prevPeriodKey: string;   // clave del período anterior para el comparativo
}

// ── Núcleo compartido ────────────────────────────────────────────────────────
async function runRadarCore(client: ClientConfig, period: RadarPeriod): Promise<RadarDbResult> {
  if (!client.radar_folder_id) {
    throw new Error(`El cliente '${client.name}' no tiene carpeta de Drive para el Radar (radar_folder_id).`);
  }

  const minDur   = client.radar_min_duration_seconds    ?? RADAR_MIN_DURATION_DEFAULT;
  const maxChars = client.radar_transcripcion_max_chars ?? RADAR_MAX_CHARS_DEFAULT;

  // Roster del cliente: define que llamadas de la hoja le pertenecen. Se incluyen
  // los inactivos porque un asesor dado de baja hoy pudo tener llamadas en el
  // periodo analizado, y esas llamadas siguen siendo de este equipo.
  const roster = await listAdvisors(client.id, { includeInactive: true });
  if (roster.length === 0) {
    throw new Error(
      `El cliente '${client.name}' no tiene asesores registrados, y el Radar los necesita para saber ` +
      `que llamadas le pertenecen. Da de alta su equipo en Ajustes y vuelve a intentarlo.`,
    );
  }
  const isMine = rosterMatcher(roster.map(a => a.name));

  // Lee TODAS las llamadas del período (umbral 0) para conocer el total; luego
  // filtra a >= minDur en memoria. Una llamada sin duración legible (0) se incluye.
  // La fuente (hoja o Postgres) la resuelve readCalls segun el cliente.
  const allPeriodCalls = await readCalls(client, {
    month:       period.month,
    dateFrom:    period.useRange ? period.dateFrom : undefined,
    dateTo:      period.useRange ? period.dateTo   : undefined,
    minDuracion: 0,
    maxChars,
  });
  // El total que se reporta es el del equipo de ESTE cliente, no el de la hoja.
  const periodCalls = allPeriodCalls.filter(c => isMine(c.asesor));
  const foreign     = allPeriodCalls.length - periodCalls.length;
  if (foreign > 0) {
    console.log(
      `[radar] ${foreign} llamada(s) de la hoja no pertenecen al roster de '${client.name}' y quedan fuera ` +
      `(quedan ${periodCalls.length} del equipo).`,
    );
  }
  if (periodCalls.length === 0) {
    throw new Error(
      `Ninguna llamada de ${period.periodLabel} pertenece a los asesores registrados de '${client.name}'. ` +
      `Revisa que los nombres del roster coincidan con los de las llamadas.`,
    );
  }

  const total = periodCalls.length;
  const kept = periodCalls.filter(c => c.duracion_segundos === 0 || c.duracion_segundos >= minDur);

  const calls: RadarCall[] = kept.map((c, i) => ({
    index:          i + 1,
    fecha:          c.fecha,
    asesor:         c.asesor || 'Sin asesor',
    duracion_label: secondsToLabel(c.duracion_segundos),
    transcripcion:  c.transcripcion,
  }));

  if (calls.length === 0) {
    throw new Error(`No hay llamadas de más de ${minDur} s en ${period.periodLabel} para '${client.name}'.`);
  }

  // Sidecar del período anterior (comparativo). Carpeta: la de sidecars si existe, si no la de Radar.
  const sidecarFolder = client.radar_sidecar_folder_id || client.radar_folder_id;
  const prevText = await findRadarSidecar(sidecarFolder, period.prevPeriodKey);
  const prevSidecar = prevText ? parseRadarSidecar(prevText) : null;

  const meta: RadarPeriodMeta = {
    client_name:    client.name,
    period_label:   period.periodLabel,
    period_key:     period.periodKey,
    date_from:      period.dateFrom,
    date_to:        period.dateTo,
    total_calls:    total,
    analyzed_calls: calls.length,
    excluded_calls: total - calls.length,
    source:         'database',
  };

  // El segundo argumento es obligatorio en la practica: sin el, el default
  // rellena su {contexto} con "No se proporciono contexto" y TODOS los Radar
  // del dashboard salian sin contexto de negocio, incluso con el configurado.
  const systemPrompt = resolveRadarPrompt(client.prompt_radar ?? null, client.contexto_negocio);
  const result = await processRadarReport(systemPrompt, meta, calls, prevSidecar);

  // La etiqueta del periodo distingue los dos cortes de un mismo mes, así que
  // el PDF de la 1ª quincena no pisa al de la 2ª.
  const driveUrl = await uploadPdfNamed(
    client.radar_folder_id,
    radarFilename(clientFileLabel(client), period.periodLabel),
    result.pdfBuffer,
  );
  await uploadRadarSidecar(sidecarFolder, period.periodKey, result.sidecarJson);

  return {
    reportData:    result.reportData,
    driveUrl,
    pdfBuffer:     result.pdfBuffer,
    input_tokens:  result.input_tokens,
    output_tokens: result.output_tokens,
  };
}

// ── Mensual (period_key = 'YYYY-MM') ─────────────────────────────────────────
export async function runRadarForClient(client: ClientConfig, month: string): Promise<RadarDbResult> {
  const { from, to } = monthBounds(month);
  return runRadarCore(client, {
    periodKey:     month,
    periodLabel:   monthLabel(month),
    dateFrom:      from,
    dateTo:        to,
    month,
    useRange:      false,
    prevPeriodKey: previousMonth(month),
  });
}

// ── Quincenal ────────────────────────────────────────────────────────────────
// Dos cortes por mes: la 1ª quincena (días 1–15) y la 2ª quincena (día 16–fin).
//   period_key  = 'YYYY-MM-Q1' | 'YYYY-MM-Q2'
//   comparativo = quincena inmediatamente anterior (Q1 ↔ Q2 del mes previo).
export interface Fortnight {
  periodKey:     string;
  periodLabel:   string;
  dateFrom:      string;
  dateTo:        string;
  month:         string;
  prevPeriodKey: string;
}

// Describe una quincena concreta de un mes. Es la pieza que necesita el flujo
// manual (el usuario elige mes + quincena); el scheduler solo usa el atajo de
// abajo, que resuelve cuál acaba de cerrar.
export function fortnightFor(month: string, half: 'Q1' | 'Q2'): Fortnight {
  const [y, m] = month.split('-').map(Number);
  if (half === 'Q1') {
    return {
      periodKey:     `${month}-Q1`,
      periodLabel:   `1ª quincena · ${monthLabel(month)}`,
      dateFrom:      `${month}-01`,
      dateTo:        `${month}-15`,
      month,
      prevPeriodKey: `${previousMonth(month)}-Q2`,
    };
  }
  return {
    periodKey:     `${month}-Q2`,
    periodLabel:   `2ª quincena · ${monthLabel(month)}`,
    dateFrom:      `${month}-16`,
    dateTo:        `${month}-${pad(new Date(y, m, 0).getDate())}`,
    month,
    prevPeriodKey: `${month}-Q1`,
  };
}

// Devuelve la quincena que ACABA de cerrar antes de `today` (YYYY-MM-DD):
//   • si hoy es día 1–15  → 2ª quincena del mes anterior.
//   • si hoy es día ≥16   → 1ª quincena del mes actual.
export function fortnightForRun(today: string): Fortnight {
  const [y, m, d] = today.split('-').map(Number);
  const thisMonth = `${y}-${pad(m)}`;
  return d >= 16
    ? fortnightFor(thisMonth, 'Q1')
    : fortnightFor(previousMonth(thisMonth), 'Q2');
}

export async function runRadarForClientFortnight(client: ClientConfig, f: Fortnight): Promise<RadarDbResult> {
  return runRadarCore(client, {
    periodKey:     f.periodKey,
    periodLabel:   f.periodLabel,
    dateFrom:      f.dateFrom,
    dateTo:        f.dateTo,
    month:         f.month,
    useRange:      true,
    prevPeriodKey: f.prevPeriodKey,
  });
}
