import { google } from 'googleapis';
import { Readable } from 'stream';
import { getAuth } from './auth';

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDateShort(d: string): string {
  const parts = d.split('-');
  return `${parts[2]}/${parts[1]}`;
}

// "Sofia Fractional Residences | Análisis de Llamadas | Mayo 2026"
// or "Sofia Fractional Residences | Análisis de Llamadas | Mayo 2026 | Semana 05/05 al 11/05"
export function reportFilename(
  clientName: string,
  month: string,
  dateFrom?: string,
  dateTo?: string,
): string {
  const base = `${clientName} | Analisis de Llamadas | ${monthLabel(month)}`;
  if (dateFrom && dateTo) {
    return `${base} | Semana ${fmtDateShort(dateFrom)} al ${fmtDateShort(dateTo)}`;
  }
  return base;
}

// "Sidecar_Ana Lopez_2026-05" (monthly) or "Sidecar_Ana Lopez_2026-05-05" (weekly)
export function sidecarFilename(advisorName: string, periodKey: string): string {
  return `Sidecar_${advisorName}_${periodKey}`;
}

export function previousPeriodKey(
  month: string,
  periodType: 'monthly' | 'weekly',
  dateFrom?: string,
): string {
  if (periodType === 'weekly' && dateFrom) {
    const d = new Date(dateFrom + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().split('T')[0];
  }
  return previousMonth(month);
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

// ── Sidecar folder — auto-creates "_Sidecars" subfolder on first use ──────────

const _sidecarFolderCache = new Map<string, string>();

export async function ensureSidecarFolder(parentFolderId: string): Promise<string> {
  if (_sidecarFolderCache.has(parentFolderId)) {
    return _sidecarFolderCache.get(parentFolderId)!;
  }

  const drive = getDrive();
  const FOLDER_NAME = '_Sidecars';
  const MIME_FOLDER  = 'application/vnd.google-apps.folder';

  const list = await drive.files.list({
    q: [
      `'${parentFolderId}' in parents`,
      `name = '${FOLDER_NAME}'`,
      `mimeType = '${MIME_FOLDER}'`,
      `trashed = false`,
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let folderId: string;
  if (list.data.files && list.data.files.length > 0) {
    folderId = list.data.files[0].id!;
    console.log(`[drive] Found existing _Sidecars folder: ${folderId}`);
  } else {
    const created = await drive.files.create({
      requestBody: { name: FOLDER_NAME, mimeType: MIME_FOLDER, parents: [parentFolderId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    folderId = created.data.id!;
    console.log(`[drive] Created _Sidecars folder: ${folderId}`);
  }

  _sidecarFolderCache.set(parentFolderId, folderId);
  return folderId;
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadPdf(
  folderId:  string,
  clientName: string,
  month:     string,
  pdfBuffer: Buffer,
  dateFrom?: string,
  dateTo?: string,
): Promise<string> {
  const drive = getDrive();
  const name  = `${reportFilename(clientName, month, dateFrom, dateTo)}.pdf`;

  let res;
  try {
    res = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('notFound') || msg.includes('File not found') || msg.includes('404')) {
      throw new Error(
        `La carpeta de Drive (ID: ${folderId}) no es accesible. ` +
        `Verifica que sea una Unidad Compartida y que la service account sea miembro con rol Colaborador o superior.`,
      );
    }
    if (msg.includes('storageQuota') || msg.includes('storage quota')) {
      throw new Error(
        `La service account no tiene cuota de almacenamiento. ` +
        `La carpeta debe estar en una Unidad Compartida (no en Mi Unidad). ` +
        `Crea una Unidad Compartida, mueve la carpeta ahi y agrega la service account como miembro.`,
      );
    }
    throw err;
  }

  if (!res.data.webViewLink) {
    throw new Error(`Drive upload succeeded but returned no webViewLink for ${name}`);
  }

  return res.data.webViewLink;
}

// ── Previous report lookup ────────────────────────────────────────────────────

const MIME_GDOC = 'application/vnd.google-apps.document';
const MIME_TEXT = 'text/plain';

async function downloadText(fileId: string, mimeType: string): Promise<string> {
  const drive = getDrive();

  if (mimeType === MIME_GDOC) {
    const res = await drive.files.export(
      { fileId, mimeType: MIME_TEXT },
      { responseType: 'text' },
    );
    return String(res.data);
  }

  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' },
  );
  return String(res.data);
}

export async function uploadReportSidecar(
  sidecarFolderId: string,
  advisorName:     string,
  periodKey:       string,  // 'YYYY-MM' monthly | 'YYYY-MM-DD' weekly
  text:            string,
): Promise<void> {
  const drive = getDrive();
  const name  = `${sidecarFilename(advisorName, periodKey)}.txt`;
  await drive.files.create({
    requestBody: { name, parents: [sidecarFolderId] },
    media: { mimeType: MIME_TEXT, body: Readable.from(Buffer.from(text, 'utf-8')) },
    supportsAllDrives: true,
  });
}

// The key that identifies the period currently being analysed.
export function currentPeriodKey(
  month: string,
  periodType: 'monthly' | 'weekly',
  dateFrom?: string,
): string {
  return periodType === 'weekly' && dateFrom ? dateFrom : month;
}

// Normalise any period key to a comparable start date (YYYY-MM-DD).
// Monthly keys ('YYYY-MM') become the 1st of the month so they sort correctly
// alongside weekly keys ('YYYY-MM-DD').
function keyStartDate(periodKey: string): string {
  return /^\d{4}-\d{2}$/.test(periodKey) ? `${periodKey}-01` : periodKey;
}

// Finds the MOST RECENT sidecar for this advisor that predates the current
// period — instead of requiring the exact immediately-previous period to exist.
// This makes the period-over-period comparison resilient to: non-contiguous
// weeks, switching between monthly/weekly cadence, and month-boundary date
// clamping. Returns null only when no earlier sidecar exists at all.
export async function findPreviousReport(
  sidecarFolderId: string,
  advisorName:     string,
  month:           string,
  periodType:      'monthly' | 'weekly' = 'monthly',
  dateFrom?:       string,
): Promise<string | null> {
  const drive      = getDrive();
  const prefix     = `${sidecarFilename(advisorName, '')}`;          // "Sidecar_{name}_"
  const currentKey = currentPeriodKey(month, periodType, dateFrom);
  const currentStart = keyStartDate(currentKey);

  let list;
  try {
    list = await drive.files.list({
      q: [
        `'${sidecarFolderId}' in parents`,
        `name contains '${prefix.replace(/'/g, "\\'")}'`,
        `trashed = false`,
      ].join(' and '),
      fields: 'files(id,name,mimeType)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  } catch (err) {
    console.warn(`[drive] Could not list sidecar files:`, err instanceof Error ? err.message : err);
    return null;
  }

  const files = list.data.files ?? [];

  // Extract the period key from each filename and keep only sidecars strictly
  // before the current period.
  const candidates = files
    .map(f => {
      const name = f.name ?? '';
      if (!name.startsWith(prefix) || !name.endsWith('.txt')) return null;
      const key = name.slice(prefix.length, -'.txt'.length);
      return { file: f, key, start: keyStartDate(key) };
    })
    .filter((c): c is { file: typeof files[number]; key: string; start: string } =>
      c !== null && c.start < currentStart)
    .sort((a, b) => b.start.localeCompare(a.start));   // most recent first

  if (candidates.length === 0) {
    console.log(`[drive] No previous sidecar found for ${advisorName} (before ${currentKey})`);
    return null;
  }

  const { file, key } = candidates[0];
  if (!file.id || !file.mimeType) return null;
  console.log(`[drive] Previous sidecar for ${advisorName}: key=${key} (current=${currentKey})`);

  try {
    return await downloadText(file.id, file.mimeType);
  } catch (err) {
    console.warn(`[drive] Could not read previous sidecar for ${advisorName}:`, err);
    return null;
  }
}
