import { google } from 'googleapis';
import { Readable } from 'stream';
import { getAuth } from './auth';

const MONTHS_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

// "2026-04" → "Abril 2026"
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

// "2026-04" → "2026-03"
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const prev = new Date(y, m - 2, 1); // month-2 because months are 0-indexed
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

// "Reporte Felipe Abril 2026" (used as both PDF name and search key)
export function reportFilename(advisorName: string, month: string): string {
  return `Reporte ${advisorName} ${monthLabel(month)}`;
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadPdf(
  folderId: string,
  advisorName: string,
  month: string,
  pdfBuffer: Buffer,
): Promise<string> {
  const drive = getDrive();
  const name = `${reportFilename(advisorName, month)}.pdf`;

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer),
    },
    fields: 'id,webViewLink',
  });

  if (!res.data.webViewLink) {
    throw new Error(`Drive upload succeeded but returned no webViewLink for ${name}`);
  }

  return res.data.webViewLink;
}

// ── Previous report lookup ────────────────────────────────────────────────────

const MIME_GDOC  = 'application/vnd.google-apps.document';
const MIME_TEXT  = 'text/plain';

async function downloadText(fileId: string, mimeType: string): Promise<string> {
  const drive = getDrive();

  if (mimeType === MIME_GDOC) {
    // Export Google Doc as plain text
    const res = await drive.files.export(
      { fileId, mimeType: MIME_TEXT },
      { responseType: 'text' },
    );
    return String(res.data);
  }

  // Download raw text / PDF text layer (best-effort for text files)
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' },
  );
  return String(res.data);
}

/**
 * Uploads a plain-text sidecar alongside the PDF so the next month's run can
 * read the previous report summary without extracting text from the PDF.
 */
export async function uploadReportSidecar(
  folderId: string,
  advisorName: string,
  month: string,
  text: string,
): Promise<void> {
  const drive = getDrive();
  const name = `${reportFilename(advisorName, month)}.txt`;
  await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: {
      mimeType: MIME_TEXT,
      body: Readable.from(Buffer.from(text, 'utf-8')),
    },
  });
}

/**
 * Searches the Drive folder for the previous month's report for an advisor.
 * Handles both legacy Google Docs (from n8n) and the new PDF/txt uploads.
 * Returns the text content, or null if nothing found.
 */
export async function findPreviousReport(
  folderId: string,
  advisorName: string,
  month: string, // current month, will search previous
): Promise<string | null> {
  const drive = getDrive();
  const prevMonth = previousMonth(month);
  const basename = reportFilename(advisorName, prevMonth);

  const q = [
    `'${folderId}' in parents`,
    `name contains '${basename.replace(/'/g, "\\'")}'`,
    `trashed = false`,
  ].join(' and ');

  const list = await drive.files.list({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: 5,
  });

  const files = list.data.files ?? [];
  if (files.length === 0) return null;

  // Prefer Google Doc (legacy) → then .txt → skip .pdf (no text extraction)
  const preferred = (
    files.find(f => f.mimeType === MIME_GDOC) ??
    files.find(f => f.mimeType === MIME_TEXT) ??
    files.find(f => f.mimeType !== 'application/pdf')
  );

  if (!preferred?.id || !preferred.mimeType) return null;

  try {
    return await downloadText(preferred.id, preferred.mimeType);
  } catch (err) {
    console.warn(`[drive] Could not read previous report for ${advisorName}:`, err);
    return null;
  }
}
