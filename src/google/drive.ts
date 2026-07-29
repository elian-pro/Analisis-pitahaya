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
// Nombre del PDF del Radar: "Midstorage | Radar de Objeciones | Julio 2026".
// El periodo llega ya con su etiqueta legible (mes o quincena).
export function radarFilename(clientName: string, periodLabel: string): string {
  return `${clientName} | Radar de Objeciones | ${periodLabel}`;
}

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

// ── Carpetas: crear/ubicar y navegar ─────────────────────────────────────────

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const _folderCache = new Map<string, string>();

// ID de la subcarpeta `name` dentro de `parentFolderId`, creándola si no existe.
// Idempotente: si ya está, la reusa — nunca duplica.
export async function ensureFolder(parentFolderId: string, name: string): Promise<string> {
  const cacheKey = `${parentFolderId}/${name}`;
  const cached = _folderCache.get(cacheKey);
  if (cached) return cached;

  const drive = getDrive();
  const list = await drive.files.list({
    q: [
      `'${parentFolderId}' in parents`,
      `name = '${name.replace(/'/g, "\\'")}'`,
      `mimeType = '${MIME_FOLDER}'`,
      `trashed = false`,
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let folderId = list.data.files?.[0]?.id;
  if (folderId) {
    console.log(`[drive] Found existing folder "${name}": ${folderId}`);
  } else {
    const created = await drive.files.create({
      requestBody: { name, mimeType: MIME_FOLDER, parents: [parentFolderId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    folderId = created.data.id!;
    console.log(`[drive] Created folder "${name}": ${folderId}`);
  }

  _folderCache.set(cacheKey, folderId);
  return folderId;
}

export function ensureSidecarFolder(parentFolderId: string): Promise<string> {
  return ensureFolder(parentFolderId, '_Sidecars');
}

export interface DriveEntry { id: string; name: string }

// Unidades compartidas visibles para la cuenta central — raíz del selector.
export async function listSharedDrives(): Promise<DriveEntry[]> {
  const drive = getDrive();
  const res = await drive.drives.list({ pageSize: 100, fields: 'drives(id,name)' });
  return (res.data.drives ?? []).map(d => ({ id: d.id!, name: d.name! }));
}

// Nombre y ruta legible de una carpeta, para no mostrar IDs crudos en la UI.
// La ruta se arma subiendo por los padres, con tope de saltos para no encadenar
// llamadas sin fin. Devuelve null si la carpeta no existe o no hay acceso.
export async function describeFolder(
  id: string,
): Promise<{ id: string; name: string; path: string; parentId: string } | null> {
  const drive = getDrive();
  try {
    const res = await drive.files.get({
      fileId: id, fields: 'id,name,parents', supportsAllDrives: true,
    });
    const trail: string[] = [];
    let parents = res.data.parents;
    for (let hop = 0; hop < 6 && parents && parents.length; hop++) {
      const p = await drive.files.get({
        fileId: parents[0], fields: 'id,name,parents', supportsAllDrives: true,
      });
      trail.unshift(p.data.name || '');
      parents = p.data.parents;
    }
    // parentId permite deducir la ubicación de clientes dados de alta antes de
    // que existiera el selector: es la carpeta madre donde ya viven las suyas.
    return {
      id,
      name: res.data.name || '',
      path: trail.join(' / '),
      parentId: res.data.parents?.[0] ?? '',
    };
  } catch (err) {
    console.warn(`[drive] No se pudo describir la carpeta ${id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Subcarpetas de `parentId` (el ID de una Unidad Compartida sirve como su raíz).
export async function listFolders(parentId: string): Promise<DriveEntry[]> {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = '${MIME_FOLDER}' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: 200,
    orderBy: 'name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []).map(f => ({ id: f.id!, name: f.name! }));
}

// Read-only lookup of the "_Sidecars" subfolder. Unlike ensureSidecarFolder it
// never creates anything — used by GET endpoints (e.g. the prior-period hint)
// that must not have side effects. Returns null when the folder doesn't exist.
export async function findSidecarFolder(parentFolderId: string): Promise<string | null> {
  const cacheKey = `${parentFolderId}/_Sidecars`;
  const cached = _folderCache.get(cacheKey);
  if (cached) return cached;
  const drive = getDrive();
  const list = await drive.files.list({
    q: [
      `'${parentFolderId}' in parents`,
      `name = '_Sidecars'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `trashed = false`,
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const folderId = list.data.files?.[0]?.id ?? null;
  if (folderId) _folderCache.set(cacheKey, folderId);
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
  return uploadPdfNamed(folderId, reportFilename(clientName, month, dateFrom, dateTo), pdfBuffer);
}

// Sube el PDF con un nombre ya resuelto. Lo usa el Radar, que no se llama
// "Analisis de Llamadas" y por tanto no pasa por reportFilename().
export async function uploadPdfNamed(
  folderId:  string,
  baseName:  string,
  pdfBuffer: Buffer,
): Promise<string> {
  const drive = getDrive();
  const name  = `${baseName}.pdf`;

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
        `Verifica que la cuenta de Google conectada sea dueña de la carpeta o tenga acceso de Editor ` +
        `(si es una Unidad Compartida, que sea miembro con rol Colaborador o superior).`,
      );
    }
    if (msg.includes('storageQuota') || msg.includes('storage quota')) {
      throw new Error(
        `La cuenta de Google conectada se quedó sin cuota de almacenamiento en Drive. ` +
        `Libera espacio, o usa una carpeta en una Unidad Compartida (que no consume la cuota personal).`,
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
const MIME_JSON = 'application/json';

// ── Sidecar del Radar: _Sidecars/radar-YYYY-MM.json dentro de la carpeta Radar ─
// Mismo esquema que los sidecars de asesores, para que la carpeta que ve el
// cliente tenga solo PDFs. El nombre lleva prefijo propio para no confundir a
// findPreviousReport. Habilita el comparativo periodo contra periodo.
//
// Los clientes anteriores a esta subcarpeta los tienen sueltos en la raíz: la
// lectura mira los dos sitios y la escritura se los lleva a _Sidecars.
function radarSidecarName(periodKey: string): string {
  return `radar-${periodKey}.json`;
}

async function filesNamed(folderId: string, name: string): Promise<Array<{ id: string; mimeType?: string }>> {
  const list = await getDrive().files.list({
    q: [`'${folderId}' in parents`, `name = '${name}'`, `trashed = false`].join(' and '),
    fields: 'files(id,mimeType)', pageSize: 10,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return (list.data.files ?? []).filter(f => f.id).map(f => ({ id: f.id!, mimeType: f.mimeType ?? undefined }));
}

export async function findRadarSidecar(folderId: string, periodKey: string): Promise<string | null> {
  const name = radarSidecarName(periodKey);
  try {
    const sub = await findSidecarFolder(folderId);
    const hit = (sub ? (await filesNamed(sub, name))[0] : undefined)
             ?? (await filesNamed(folderId, name))[0];   // legado: suelto en la raíz
    if (!hit) return null;
    return await downloadText(hit.id, hit.mimeType || MIME_JSON);
  } catch (err) {
    console.warn(`[drive] Could not read radar sidecar ${name}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function uploadRadarSidecar(folderId: string, periodKey: string, json: string): Promise<void> {
  const drive = getDrive();
  const name = radarSidecarName(periodKey);
  const target = await ensureSidecarFolder(folderId);
  try {
    // Borra la versión previa del mismo periodo (en _Sidecars y en la raíz, por
    // si venía de antes) para que re-generar no deje duplicados.
    for (const parent of [target, folderId]) {
      for (const f of await filesNamed(parent, name)) {
        await drive.files.delete({ fileId: f.id, supportsAllDrives: true });
      }
    }
    await moveLooseRadarSidecars(folderId, target);
  } catch (err) {
    console.warn(`[drive] Could not clean old radar sidecar ${name}:`, err instanceof Error ? err.message : err);
  }
  await drive.files.create({
    requestBody: { name, parents: [target] },
    media: { mimeType: MIME_JSON, body: Readable.from(Buffer.from(json, 'utf-8')) },
    supportsAllDrives: true,
  });
}

// Arrastra a _Sidecars los radar-*.json que quedaron sueltos en la carpeta del
// Radar. Corre al generar, así cada cliente se limpia solo en su siguiente
// reporte y no hace falta migrar nada a mano.
async function moveLooseRadarSidecars(folderId: string, sidecarFolderId: string): Promise<void> {
  const drive = getDrive();
  const list = await drive.files.list({
    q: [`'${folderId}' in parents`, `mimeType = '${MIME_JSON}'`, `trashed = false`].join(' and '),
    fields: 'files(id,name)', pageSize: 200,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  for (const f of list.data.files ?? []) {
    if (!f.id || !/^radar-.+\.json$/.test(f.name ?? '')) continue;
    await drive.files.update({
      fileId: f.id, addParents: sidecarFolderId, removeParents: folderId, supportsAllDrives: true,
    });
    console.log(`[drive] Sidecar del Radar movido a _Sidecars: ${f.name}`);
  }
}

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
export function keyStartDate(periodKey: string): string {
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

// Lightweight existence check used by the UI to tell — before a report runs —
// whether a prior period exists to compare against. Unlike findPreviousReport
// it does NOT download any sidecar contents: it only lists filenames and returns
// the MOST RECENT prior period key across the given advisors (or null if none).
export async function findPreviousPeriodKey(
  sidecarFolderId: string,
  advisorNames:    string[],
  month:           string,
  periodType:      'monthly' | 'weekly' = 'monthly',
  dateFrom?:       string,
): Promise<string | null> {
  if (advisorNames.length === 0) return null;
  const drive        = getDrive();
  const currentKey   = currentPeriodKey(month, periodType, dateFrom);
  const currentStart = keyStartDate(currentKey);

  let list;
  try {
    list = await drive.files.list({
      q: [
        `'${sidecarFolderId}' in parents`,
        `name contains 'Sidecar_'`,
        `trashed = false`,
      ].join(' and '),
      fields: 'files(id,name)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  } catch (err) {
    console.warn(`[drive] Could not list sidecar files:`, err instanceof Error ? err.message : err);
    return null;
  }

  const wanted = new Set(advisorNames);
  let bestKey: string | null = null;
  let bestStart = '';

  for (const f of list.data.files ?? []) {
    const name = f.name ?? '';
    if (!name.startsWith('Sidecar_') || !name.endsWith('.txt')) continue;
    // "Sidecar_{advisor}_{periodKey}.txt" — period keys never contain '_', so the
    // last underscore splits the (possibly underscore-containing) advisor name
    // from the period key.
    const body = name.slice('Sidecar_'.length, -'.txt'.length);
    const sep  = body.lastIndexOf('_');
    if (sep < 0) continue;
    const advisor = body.slice(0, sep);
    const key     = body.slice(sep + 1);
    if (!wanted.has(advisor)) continue;
    const start = keyStartDate(key);
    if (start >= currentStart) continue;          // not a prior period
    if (start > bestStart) { bestStart = start; bestKey = key; }
  }

  return bestKey;
}
