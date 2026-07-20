import type { ClientConfig } from '../clients/manager';
import { getCallData, type SheetColumns } from '../google/sheets';
import { monthLabel, previousMonth, uploadPdf, findRadarSidecar, uploadRadarSidecar } from '../google/drive';
import { resolveRadarPrompt, type RadarCall, type RadarPeriodMeta } from '../claude/radar';
import { parseRadarSidecar } from './sidecar';
import { processRadarReport } from './process';
import type { RadarReportData } from '../schemas/radar';

// ─────────────────────────────────────────────────────────────────────────────
// Flujo del Radar desde la base de datos: un cliente + un período. Lee la hoja
// con el cap y umbral propios del Radar (default 8000 chars / 200 s), busca el
// sidecar del período anterior para el comparativo, genera el reporte, sube el
// PDF a la carpeta de Radar y persiste el sidecar. Lo usan el runner (scheduler)
// y el endpoint manual.
//
// Períodos soportados:
//   • Mensual  → runRadarForClient(client, 'YYYY-MM')          (period_key = mes)
//   • Quincenal→ runRadarForClientRange(client, {…})           (period_key = YYYY-MM-Q1|Q2)
// El comparativo compara contra el período inmediatamente anterior del mismo tipo.
// ─────────────────────────────────────────────────────────────────────────────

export const RADAR_MIN_DURATION_DEFAULT = 200;
export const RADAR_MAX_CHARS_DEFAULT     = 8000;

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

  const cols: SheetColumns = {
    fecha: client.col_fecha, asesor: client.col_asesor, calif: client.col_calif,
    analisis: client.col_analisis, transcripcion: client.col_transcripcion,
    duracion: client.col_duracion, record: client.col_record,
  };

  // Lee TODAS las llamadas del período (umbral 0) para conocer el total; luego
  // filtra a >= minDur en memoria. Una llamada sin duración legible (0) se incluye.
  const periodCalls = await getCallData(
    client.spreadsheet_id, client.data_sheet_name, cols, period.month,
    client.excluded_phrases, maxChars,
    period.useRange ? period.dateFrom : undefined,
    period.useRange ? period.dateTo   : undefined,
    0,
  );
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

  const systemPrompt = resolveRadarPrompt(client.prompt_radar ?? null);
  const result = await processRadarReport(systemPrompt, meta, calls, prevSidecar);

  // Nombre del PDF: mensual conserva el nombre histórico; quincenal añade la
  // etiqueta de la quincena para que ambos cortes del mes no colisionen.
  const pdfLabel = period.periodKey === period.month
    ? `${client.name} · Radar`
    : `${client.name} · Radar · ${period.periodLabel}`;
  const driveUrl = await uploadPdf(client.radar_folder_id, pdfLabel, period.month, result.pdfBuffer);
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

// Devuelve la quincena que ACABA de cerrar antes de `today` (YYYY-MM-DD):
//   • si hoy es día 1–15  → 2ª quincena del mes anterior.
//   • si hoy es día ≥16   → 1ª quincena del mes actual.
export function fortnightForRun(today: string): Fortnight {
  const [y, m, d] = today.split('-').map(Number);
  const ML = (mm: string) => monthLabel(mm);

  if (d >= 16) {
    // 1ª quincena del mes actual (1–15)
    const mkey = `${y}-${pad(m)}`;
    return {
      periodKey:     `${mkey}-Q1`,
      periodLabel:   `1ª quincena · ${ML(mkey)}`,
      dateFrom:      `${mkey}-01`,
      dateTo:        `${mkey}-15`,
      month:         mkey,
      prevPeriodKey: `${previousMonth(mkey)}-Q2`,
    };
  }
  // 2ª quincena del mes anterior (16–fin)
  const prev = previousMonth(`${y}-${pad(m)}`);
  const [py, pm] = prev.split('-').map(Number);
  const lastDay = new Date(py, pm, 0).getDate();
  return {
    periodKey:     `${prev}-Q2`,
    periodLabel:   `2ª quincena · ${ML(prev)}`,
    dateFrom:      `${prev}-16`,
    dateTo:        `${prev}-${pad(lastDay)}`,
    month:         prev,
    prevPeriodKey: `${prev}-Q1`,
  };
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
