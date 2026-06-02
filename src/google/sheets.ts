import { google } from 'googleapis';
import { getAuth } from './auth';

export interface Advisor {
  asesor: string;
  row_number: number;
}

export interface CallRow {
  fecha: string;
  asesor: string;
  calif: string;
  analisis: string;
  transcripcion: string;
  rowNumber: number;
}

export interface SheetColumns {
  fecha: string;
  asesor: string;
  calif: string;
  analisis: string;
  transcripcion: string;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseSheetDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;

  // Google Sheets serial number (days since 30 Dec 1899)
  if (typeof raw === 'number') {
    return new Date((raw - 25569) * 86400 * 1000);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // DD/MM/YYYY or D/M/YYYY (common in Mexico)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  }

  // YYYY-MM-DD
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

/**
 * Returns unique advisor names found in the DATA sheet for a specific month.
 * This is the preferred source because the names are guaranteed to match
 * the call data — no cross-sheet name discrepancy is possible.
 */
export async function getAdvisorsForMonth(
  spreadsheetId: string,
  dataSheetName: string,
  colFecha: string,
  colAsesor: string,
  month: string,
): Promise<Advisor[]> {
  const rows = await readSheet(spreadsheetId, dataSheetName);
  if (rows.length < 2) return [];

  const headers = rows[0].map(String);
  const fechaIdx  = headerIndex(headers, colFecha);
  const asesorIdx = headerIndex(headers, colAsesor);
  if (asesorIdx === -1) return [];

  const seen = new Map<string, number>(); // name → first row_number

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

export async function getAdvisors(
  spreadsheetId: string,
  sheetName: string,
  colAsesor: string,
): Promise<Advisor[]> {
  const rows = await readSheet(spreadsheetId, sheetName);
  if (rows.length === 0) return [];

  const headers = rows[0].map(String);
  let colIdx = headerIndex(headers, colAsesor);

  // Fall back to first column if named column not found
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
  month: string, // YYYY-MM
  excludedPhrases: string[],
  maxTranscripcionChars: number,
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
  };

  const result: CallRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const rawFecha = idx.fecha >= 0 ? row[idx.fecha] : null;
    const date = parseSheetDate(rawFecha);
    if (!date || !matchesMonth(date, month)) continue;

    let transcripcion = idx.transcripcion >= 0
      ? String(row[idx.transcripcion] ?? '').trim()
      : '';

    // Skip rows whose transcription contains excluded phrases
    const lower = transcripcion.toLowerCase();
    if (excludedPhrases.some(p => lower.includes(p.toLowerCase()))) continue;

    if (transcripcion.length > maxTranscripcionChars) {
      transcripcion = transcripcion.slice(0, maxTranscripcionChars);
    }

    result.push({
      fecha:         String(rawFecha ?? ''),
      asesor:        idx.asesor >= 0 ? String(row[idx.asesor] ?? '').trim() : '',
      calif:         idx.calif >= 0  ? String(row[idx.calif]  ?? '').trim() : '',
      analisis:      idx.analisis >= 0 ? String(row[idx.analisis] ?? '').trim() : '',
      transcripcion,
      rowNumber: i + 1,
    });
  }

  return result;
}
