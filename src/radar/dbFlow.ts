import type { ClientConfig } from '../clients/manager';
import { getCallData, type SheetColumns } from '../google/sheets';
import { monthLabel, previousMonth, uploadPdf, findRadarSidecar, uploadRadarSidecar } from '../google/drive';
import { resolveRadarPrompt, type RadarCall, type RadarPeriodMeta } from '../claude/radar';
import { parseRadarSidecar } from './sidecar';
import { processRadarReport } from './process';
import type { RadarReportData } from '../schemas/radar';

// ─────────────────────────────────────────────────────────────────────────────
// Flujo del Radar desde la base de datos: un cliente + un mes. Lee la hoja con el
// cap y umbral propios del Radar (default 8000 chars / 200 s), busca el sidecar
// del mes anterior para el comparativo, genera el reporte, sube el PDF a la
// carpeta de Radar y persiste el sidecar. Lo usan el runner (scheduler) y el
// endpoint manual POST /api/report/radar. Es MENSUAL por diseño.
// ─────────────────────────────────────────────────────────────────────────────

export const RADAR_MIN_DURATION_DEFAULT = 200;
export const RADAR_MAX_CHARS_DEFAULT     = 8000;

function secondsToLabel(sec: number): string | undefined {
  if (!sec || sec <= 0) return undefined;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
}

export interface RadarDbResult {
  reportData:    RadarReportData;
  driveUrl:      string;
  pdfBuffer:     Buffer;
  input_tokens:  number;
  output_tokens: number;
}

export async function runRadarForClient(client: ClientConfig, month: string): Promise<RadarDbResult> {
  if (!client.radar_folder_id) {
    throw new Error(`El cliente '${client.name}' no tiene carpeta de Drive para el Radar (radar_folder_id).`);
  }

  const minDur  = client.radar_min_duration_seconds    ?? RADAR_MIN_DURATION_DEFAULT;
  const maxChars = client.radar_transcripcion_max_chars ?? RADAR_MAX_CHARS_DEFAULT;

  const cols: SheetColumns = {
    fecha: client.col_fecha, asesor: client.col_asesor, calif: client.col_calif,
    analisis: client.col_analisis, transcripcion: client.col_transcripcion,
    duracion: client.col_duracion, record: client.col_record,
  };

  // Lee TODAS las llamadas del mes (umbral 0) para conocer el total; luego filtra
  // a >= minDur en memoria. Una llamada sin duración legible (0) se incluye.
  const periodCalls = await getCallData(
    client.spreadsheet_id, client.data_sheet_name, cols, month,
    client.excluded_phrases, maxChars, undefined, undefined, 0,
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
    throw new Error(`No hay llamadas de más de ${minDur} s en ${monthLabel(month)} para '${client.name}'.`);
  }

  // Sidecar del mes anterior (comparativo). Carpeta: la de sidecars si existe, si no la de Radar.
  const sidecarFolder = client.radar_sidecar_folder_id || client.radar_folder_id;
  const prevText = await findRadarSidecar(sidecarFolder, previousMonth(month));
  const prevSidecar = prevText ? parseRadarSidecar(prevText) : null;

  const { from, to } = monthBounds(month);
  const meta: RadarPeriodMeta = {
    client_name:    client.name,
    period_label:   monthLabel(month),
    period_key:     month,
    date_from:      from,
    date_to:        to,
    total_calls:    total,
    analyzed_calls: calls.length,
    excluded_calls: total - calls.length,
    source:         'database',
  };

  const systemPrompt = resolveRadarPrompt(client.prompt_radar ?? null);
  const result = await processRadarReport(systemPrompt, meta, calls, prevSidecar);

  const driveUrl = await uploadPdf(client.radar_folder_id, `${client.name} · Radar`, month, result.pdfBuffer);
  await uploadRadarSidecar(sidecarFolder, month, result.sidecarJson);

  return {
    reportData:    result.reportData,
    driveUrl,
    pdfBuffer:     result.pdfBuffer,
    input_tokens:  result.input_tokens,
    output_tokens: result.output_tokens,
  };
}
