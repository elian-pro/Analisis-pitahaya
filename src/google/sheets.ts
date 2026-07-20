import { google } from 'googleapis';
import { getAuth } from './auth';

export const MIN_CALL_DURATION_SECONDS = 90;

export interface Advisor {
  asesor:     string;
  row_number: number;
}

export interface CallRow {
  fecha:             string;
  asesor:            string;
  calif:             string;
  analisis:          string;
  transcripcion:     string;
  record:            string;
  rowNumber:         number;
  duracion_segundos: number;
}

export interface SheetColumns {
  fecha:         string;
  asesor:        string;
  calif:         string;
  analisis:      string;
  transcripcion: string;
  duracion?:     string;
  record?:       string;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseSheetDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number') {
    return new Date((raw - 25569) * 86400 * 1000);
  }

  const s = String(raw).trim();
  if (!s) return null;

  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  }

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function matchesMonth(date: Date, month: string): boolean {
  const [y, m] = month.split('-').map(Number);
  return date.getFullYear() === y && date.getMonth() + 1 === m;
}

function inDateRange(date: Date, dateFrom: string, dateTo: string): boolean {
  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T23:59:59');
  return date >= from && date <= to;
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function headerIndex(headers: string[], name: string): number {
  const n = name.toLowerCase().trim();
  return headers.findIndex(h => h.toLowerCase().trim() === n);
}

async function readSheet(
  spreadsheetId: string,
  range: string,
): Promise<unknown[][]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return (res.data.values ?? []) as unknown[][];
}

// ── Public API ────────────────────────────────────────────────────────────────

// Lista los títulos de las pestañas (hojas) de un spreadsheet, para poder
// elegirlos en un menú al configurar un cliente en vez de escribirlos a mano.
export async function listSheetTabs(
  spreadsheetId: string,
): Promise<{ title: string; tabs: string[] }> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  const title = res.data.properties?.title ?? '';
  const tabs = (res.data.sheets ?? [])
    .map(s => s.properties?.title)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  return { title, tabs };
}

// Lee la primera fila (encabezados) de una pestaña, para ofrecer las columnas en
// menús al configurar un cliente. Pide solo la fila 1 para no leer toda la hoja.
export async function getSheetHeaders(spreadsheetId: string, tab: string): Promise<string[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const range = `'${tab.replace(/'/g, "''")}'!1:1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const row = (res.data.values && res.data.values[0]) || [];
  return row.map(h => String(h ?? '').trim()).filter(Boolean);
}

export async function getAdvisorsForMonth(
  spreadsheetId: string,
  dataSheetName: string,
  colFecha: string,
  colAsesor: string,
  month: string,
): Promise<Advisor[]> {
  const rows = await readSheet(spreadsheetId, dataSheetName);
  if (rows.length < 2) return [];

  const headers  = rows[0].map(String);
  const fechaIdx = headerIndex(headers, colFecha);
  const asesorIdx = headerIndex(headers, colAsesor);
  if (asesorIdx === -1) return [];

  const seen = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    if (fechaIdx >= 0) {
      const date = parseSheetDate(row[fechaIdx]);
      if (!date || !matchesMonth(date, month)) continue;
    }

    const name = String(row[asesorIdx] ?? '').trim();
    if (name && !seen.has(name)) seen.set(name, i + 1);
  }

  return [...seen.entries()]
    .map(([asesor, row_number]) => ({ asesor, row_number }))
    .sort((a, b) => a.asesor.localeCompare(b.asesor, 'es'));
}

/**
 * Names of advisors with at least one row (by date only, no duration/exclusion
 * filtering) in the given period, monthly or weekly. Used to flag advisors
 * with zero calls in the currently selected period in the UI — a lighter,
 * unambiguous signal than getCallData()'s full filtering (which also drops
 * short calls and excluded phrases: a "0 calls" flag driven by that would
 * conflate "no calls at all" with "calls filtered out", a different situation).
 */
export async function getAdvisorNamesWithCalls(
  spreadsheetId: string,
  dataSheetName: string,
  colFecha: string,
  colAsesor: string,
  month: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<Set<string>> {
  const rows = await readSheet(spreadsheetId, dataSheetName);
  if (rows.length < 2) return new Set();

  const headers   = rows[0].map(String);
  const fechaIdx  = headerIndex(headers, colFecha);
  const asesorIdx = headerIndex(headers, colAsesor);
  if (asesorIdx === -1) return new Set();

  const names = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const date = fechaIdx >= 0 ? parseSheetDate(row[fechaIdx]) : null;
    const dateOk = dateFrom && dateTo
      ? (date !== null && inDateRange(date, dateFrom, dateTo))
      : (date !== null && matchesMonth(date, month));
    if (!dateOk) continue;

    const name = String(row[asesorIdx] ?? '').trim();
    if (name) names.add(name);
  }
  return names;
}

export async function getAdvisors(
  spreadsheetId: string,
  sheetName: string,
  colAsesor: string,
): Promise<Advisor[]> {
  const rows = await readSheet(spreadsheetId, sheetName);
  if (rows.length === 0) return [];

  const headers = rows[0].map(String);
  let colIdx = headerIndex(headers, colAsesor);
  if (colIdx === -1) colIdx = 0;

  const result: Advisor[] = [];
  for (let i = 1; i < rows.length; i++) {
    const val = String(rows[i][colIdx] ?? '').trim();
    if (val) result.push({ asesor: val, row_number: i + 1 });
  }
  return result;
}

export async function getCallData(
  spreadsheetId: string,
  sheetName: string,
  cols: SheetColumns,
  month: string,
  excludedPhrases: string[],
  maxTranscripcionChars: number,
  dateFrom?: string,  // YYYY-MM-DD, activates weekly range filter
  dateTo?: string,    // YYYY-MM-DD
  minDurationSeconds: number = MIN_CALL_DURATION_SECONDS,  // umbral configurable (Radar usa 0 y filtra aparte)
): Promise<CallRow[]> {
  const rows = await readSheet(spreadsheetId, sheetName);
  if (rows.length < 2) return [];

  const headers = rows[0].map(String);
  const idx = {
    fecha:         headerIndex(headers, cols.fecha),
    asesor:        headerIndex(headers, cols.asesor),
    calif:         headerIndex(headers, cols.calif),
    analisis:      headerIndex(headers, cols.analisis),
    transcripcion: headerIndex(headers, cols.transcripcion),
    duracion:      cols.duracion ? headerIndex(headers, cols.duracion) : -1,
    record:        cols.record   ? headerIndex(headers, cols.record)   : -1,
  };

  const result: CallRow[] = [];
  let discardedByDuration = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const rawFecha = idx.fecha >= 0 ? row[idx.fecha] : null;
    const date = parseSheetDate(rawFecha);

    const dateOk = dateFrom && dateTo
      ? (date !== null && inDateRange(date, dateFrom, dateTo))
      : (date !== null && matchesMonth(date, month));
    if (!dateOk) continue;

    let transcripcion = idx.transcripcion >= 0
      ? String(row[idx.transcripcion] ?? '').trim()
      : '';

    const lower = transcripcion.toLowerCase();
    if (excludedPhrases.some(p => lower.includes(p.toLowerCase()))) continue;

    if (transcripcion.length > maxTranscripcionChars) {
      transcripcion = transcripcion.slice(0, maxTranscripcionChars);
    }

    const rawDuracion    = idx.duracion >= 0 ? row[idx.duracion] : null;
    const duracionSeg    = rawDuracion !== null ? Number(rawDuracion) : NaN;
    const duracionKnown  = idx.duracion >= 0 && !isNaN(duracionSeg);

    if (duracionKnown && duracionSeg < minDurationSeconds) {
      discardedByDuration++;
      continue;
    }

    result.push({
      fecha:             String(rawFecha ?? ''),
      asesor:            idx.asesor >= 0 ? String(row[idx.asesor] ?? '').trim() : '',
      calif:             idx.calif  >= 0 ? String(row[idx.calif]  ?? '').trim() : '',
      analisis:          idx.analisis >= 0 ? String(row[idx.analisis] ?? '').trim() : '',
      transcripcion,
      record:            idx.record >= 0 ? String(row[idx.record] ?? '').trim() : '',
      rowNumber:         i + 1,
      duracion_segundos: duracionKnown ? duracionSeg : 0,
    });
  }

  if (discardedByDuration > 0) {
    console.log(
      `[sheets] ${discardedByDuration} llamada(s) descartadas por duracion < ${MIN_CALL_DURATION_SECONDS}s ` +
      `(quedan ${result.length} para analisis)`,
    );
  }

  return result;
}
