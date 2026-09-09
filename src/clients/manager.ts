import fs from 'fs';
import crypto from 'crypto';
import { CLIENTS_FILE } from '../config/paths';
import { extractSpreadsheetId, extractDriveFolderId } from '../google/urls';
import {
  dbEnabled,
  CLIENTS_TABLE,
  dbLoadAll,
  dbGet,
  dbUpsert,
  dbDelete,
  dbCount,
} from '../config/db';

export interface ClientConfig {
  id:                      string;
  name:                    string;
  // Versión corta del nombre para carpetas y archivos de Drive. Los nombres
  // comerciales largos producen archivos incómodos; el nombre completo se sigue
  // usando en la app y dentro del PDF. Vacío => se usa `name`.
  short_name?:             string;
  folder_id:               string;
  // Ubicación elegida en el selector de Drive: la carpeta (normalmente dentro de
  // una Unidad Compartida) donde la app crea el árbol del cliente al darlo de
  // alta. Se guarda solo para recordar dónde quedó.
  parent_folder_id?:       string;
  sidecar_folder_id?:      string;
  spreadsheet_id:          string;
  data_sheet_name:         string;
  advisors_sheet_name?:    string;
  col_fecha:               string;
  col_asesor:              string;
  col_calif:               string;
  col_analisis:            string;
  col_transcripcion:       string;
  col_duracion?:           string;
  col_record?:             string;
  excluded_phrases:        string[];
  transcripcion_max_chars: number;
  // Vacios => se usan los esqueletos de claude/prompts.ts con contexto_negocio.
  // Solo se rellenan para sustituir la plantilla entera, como prompt_radar.
  prompt_individual?:      string;
  prompt_general?:         string;
  // ── Radar de Objeciones (opcionales; el reporte usa defaults si faltan) ──────
  prompt_radar?:                 string;   // vacío => se usa el prompt default
  radar_folder_id?:              string;   // carpeta Drive del PDF de Radar
  radar_sidecar_folder_id?:      string;   // carpeta del sidecar radar-YYYY-MM.json (opcional)
  radar_min_duration_seconds?:   number;   // filtro de duración del Radar (default 200)
  radar_transcripcion_max_chars?: number;  // recorte de transcripción del Radar (default 8000)
  // ── Fuente de las llamadas ───────────────────────────────────────────────────
  // 'sheets' (por defecto) mantiene el comportamiento de siempre: los reportes
  // leen la hoja `Analisis`. 'postgres' hace que TODO —PDFs, Radar y Dashboard—
  // lea de <calls_schema>.analisis, que llena el pipeline propio.
  //
  // Vacío = 'sheets', para que los clientes existentes no cambien de conducta
  // por el mero hecho de desplegar esto.
  calls_source?:           'sheets' | 'postgres' | 'cliente_pg';
  // Schema de la base de Callpicker (p. ej. 'Midstorage_callpicker'). VARIOS
  // clientes pueden apuntar al mismo: Midstorage y Grupo Tactical comparten
  // cuenta y lo que los separa es su roster de asesores.
  calls_schema?:           string;

  // ── Pipeline de llamadas (lee la base de Callpicker → transcribe → analiza) ─
  // Todos opcionales: el pipeline nace apagado y los clientes existentes siguen
  // funcionando sin tocarlos.
  //
  // Descripción del negocio que se inyecta en el {contexto} de los prompts por
  // defecto. Es lo único que normalmente hay que rellenar por cliente.
  contexto_negocio?:       string;
  // De dónde salió ese contexto, cuando salió de ZCIS: su id allí y la fecha de
  // la oferta que se copió. La copia es deliberada —el texto queda editable— y
  // guardar la fecha es lo que permite avisar de que la oferta cambió después.
  zcis_id?:                string;
  zcis_actualizado_en?:    string;
  // Sustituyen el prompt entero. Vacío => se usa el default con {contexto}.
  prompt_transcripcion?:   string;
  prompt_analisis?:        string;
  // Duración mínima para transcribir. Hoy en n8n es 90 s en Midstorage, 100 s en
  // Gira y ninguna en Sofía. Vacío => MIN_CALL_DURATION_SECONDS.
  call_min_duration_seconds?: number;

  // Internal bookkeeping (not part of the public CRUD form, set by
  // advisors/store.ts): true once this client's advisor roster has been
  // imported from Sheets into the `advisors` table, so the one-time import
  // never runs again even if it found zero advisors that first time.
  advisors_seeded?:        boolean;
}

// Normaliza los campos que pueden llegar como link pegado (o como ID): extrae el
// ID real de la hoja y de las carpetas de Drive. Red de seguridad del servidor,
// para que el equipo solo tenga que copiar el link sin buscar el ID.
function normalizeIds<T extends Partial<ClientConfig>>(data: T): T {
  const out = { ...data };
  if (typeof out.spreadsheet_id === 'string')    out.spreadsheet_id = extractSpreadsheetId(out.spreadsheet_id);
  if (typeof out.folder_id === 'string')         out.folder_id = extractDriveFolderId(out.folder_id);
  if (typeof out.parent_folder_id === 'string' && out.parent_folder_id) {
    out.parent_folder_id = extractDriveFolderId(out.parent_folder_id);
  }
  if (typeof out.sidecar_folder_id === 'string' && out.sidecar_folder_id) {
    out.sidecar_folder_id = extractDriveFolderId(out.sidecar_folder_id);
  }
  if (typeof out.radar_folder_id === 'string' && out.radar_folder_id) {
    out.radar_folder_id = extractDriveFolderId(out.radar_folder_id);
  }
  if (typeof out.radar_sidecar_folder_id === 'string' && out.radar_sidecar_folder_id) {
    out.radar_sidecar_folder_id = extractDriveFolderId(out.radar_sidecar_folder_id);
  }
  return out;
}

// Nomenclatura de las carpetas de Drive. Ambas llevan el nombre del cliente
// porque viven lado a lado dentro de la ubicación elegida.
// El nombre con el que este cliente aparece en Drive: carpetas y nombres de
// archivo. Un solo sitio del que tiran todos, para que no se desincronicen.
export function clientFileLabel(client: { name?: string; short_name?: string }): string {
  return (client.short_name || '').trim() || (client.name || '').trim();
}

export function reportsFolderName(clientName: string): string {
  return `${clientName} | Analisis de llamadas IA`;
}
export function radarFolderName(clientName: string): string {
  return `${clientName} | Radar de Objeciones IA`;
}

// ── Plan de entrega de un reporte ────────────────────────────────────────────
// Un cliente gestionado entrega por Drive (con sidecars redundantes y Radar);
// un cliente externo (cliente_pg) entrega por descarga efímera y NADA toca
// Drive ni Chat. recordReportMetrics no aparece aquí a propósito: corre
// siempre, es lo que sostiene el comparativo periodo-a-periodo sin Drive.
// `archivo` es la unica compuerta de "solo clientes externos" del archivo de 90
// dias. Vive aqui y no repartida por el codigo porque esta funcion existe justo
// para que el interruptor externo/gestionado tenga un solo hogar. No se
// reutiliza `vault` aunque hoy sea el mismo predicado: runRadarCore no tiene
// vault, leerlo alli seria mentir sobre la intencion, y el dia que diverjan uno
// seguiria al otro en silencio.
export interface DeliveryPlan { drive: boolean; sidecarsDrive: boolean; radar: boolean; vault: boolean; archivo: boolean }

export function planDeEntrega(c: Pick<ClientConfig, 'calls_source'>): DeliveryPlan {
  return c.calls_source === 'cliente_pg'
    ? { drive: false, sidecarsDrive: false, radar: true, vault: true,  archivo: true  }
    : { drive: true,  sidecarsDrive: true,  radar: true, vault: false, archivo: false };
}

// Qué carpetas crear en la ubicación elegida. Ambas por defecto; el formulario
// las desmarca por separado (un cliente puede ya tener la de análisis y
// necesitar solo la de Radar, o al revés).
export interface FolderChoice { reports?: boolean; radar?: boolean }

// Crea las carpetas del cliente en Drive cuando se eligió una ubicación en el
// selector. Cada carpeta se evalúa por separado: tener folder_id no impide
// crear la de Radar. `_Sidecars` no va aquí: cada carpeta crea la suya sola al
// generar su primer reporte.
// Idempotente y sin costo cuando la carpeta ya está (no llama a Drive).
// `mkdir` es parámetro solo para poder probar la decisión sin llamar a Drive.
export async function ensureClientFolders<T extends Partial<ClientConfig>>(
  data: T,
  choice: FolderChoice = {},
  // Import diferido: cargar google/drive valida el env y aborta el proceso, y
  // este módulo se usa también donde no hay credenciales (tests, CLI).
  mkdir: (parentId: string, name: string) => Promise<string> =
    async (p, n) => (await import('../google/drive')).ensureFolder(p, n),
): Promise<T> {
  const parent = data.parent_folder_id;
  const label  = clientFileLabel(data);
  if (!parent || !label) return data;
  const out = { ...data };
  if (!out.folder_id && choice.reports !== false) {
    out.folder_id = await mkdir(parent, reportsFolderName(label));
  }
  if (!out.radar_folder_id && choice.radar !== false) {
    out.radar_folder_id = await mkdir(parent, radarFolderName(label));
  }
  return out;
}

// ── File fallback (used only when DATABASE_URL is not set) ───────────────────
function loadFromFile(): ClientConfig[] {
  try { return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8')); }
  catch { return []; }
}

function saveToFile(clients: ClientConfig[]): void {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');
}

// ── Public API (async: Postgres when DATABASE_URL is set, else JSON file) ────

export async function loadClients(): Promise<ClientConfig[]> {
  if (dbEnabled) return dbLoadAll<ClientConfig>(CLIENTS_TABLE);
  return loadFromFile();
}

export async function getClient(id: string): Promise<ClientConfig | undefined> {
  if (dbEnabled) return dbGet<ClientConfig>(CLIENTS_TABLE, id);
  return loadFromFile().find(c => c.id === id);
}

export async function createClient(
  data: Omit<ClientConfig, 'id'>,
  choice: FolderChoice = {},
): Promise<ClientConfig> {
  data = normalizeIds(data);
  data = await ensureClientFolders(data, choice);
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 28);
  const id   = `${slug}_${crypto.randomBytes(3).toString('hex')}`;
  const client: ClientConfig = { id, ...data };
  if (dbEnabled) {
    await dbUpsert(CLIENTS_TABLE, id, client);
  } else {
    const clients = loadFromFile();
    clients.push(client);
    saveToFile(clients);
  }
  return client;
}

export async function updateClient(
  id: string,
  patch: Partial<Omit<ClientConfig, 'id'>>,
  choice: FolderChoice = {},
): Promise<ClientConfig> {
  patch = normalizeIds(patch);
  if (dbEnabled) {
    const existing = await dbGet<ClientConfig>(CLIENTS_TABLE, id);
    if (!existing) throw new Error(`Client '${id}' not found`);
    const updated = await ensureClientFolders({ ...existing, ...patch, id }, choice) as ClientConfig;
    await dbUpsert(CLIENTS_TABLE, id, updated);
    return updated;
  }
  const clients = loadFromFile();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Client '${id}' not found`);
  clients[idx] = await ensureClientFolders({ ...clients[idx], ...patch, id }, choice) as ClientConfig;
  saveToFile(clients);
  return clients[idx];
}

export async function deleteClient(id: string): Promise<void> {
  if (dbEnabled) {
    await dbDelete(CLIENTS_TABLE, id);
    return;
  }
  const clients = loadFromFile();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Client '${id}' not found`);
  clients.splice(idx, 1);
  saveToFile(clients);
}

/**
 * One-time seed: if the database has no clients yet but the legacy clients.json
 * file has entries, copy them in. Runs automatically at startup so an existing
 * deployment migrates itself the first time DATABASE_URL is configured.
 */
export async function seedClientsFromFileIfEmpty(): Promise<void> {
  if (!dbEnabled) return;
  if ((await dbCount(CLIENTS_TABLE)) > 0) return;
  const fromFile = loadFromFile();
  if (fromFile.length === 0) return;
  for (const client of fromFile) {
    if (!client.id) continue;
    await dbUpsert(CLIENTS_TABLE, client.id, client);
  }
  console.log(`[clients] Seeded ${fromFile.length} client(s) from clients.json into Postgres`);
}
