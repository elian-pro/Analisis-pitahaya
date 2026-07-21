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
  folder_id:               string;
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
  prompt_individual:       string;
  prompt_general:          string;
  // ── Radar de Objeciones (opcionales; el reporte usa defaults si faltan) ──────
  prompt_radar?:                 string;   // vacío => se usa el prompt default
  radar_folder_id?:              string;   // carpeta Drive del PDF de Radar
  radar_sidecar_folder_id?:      string;   // carpeta del sidecar radar-YYYY-MM.json (opcional)
  radar_min_duration_seconds?:   number;   // filtro de duración del Radar (default 200)
  radar_transcripcion_max_chars?: number;  // recorte de transcripción del Radar (default 8000)
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

export async function createClient(data: Omit<ClientConfig, 'id'>): Promise<ClientConfig> {
  data = normalizeIds(data);
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
): Promise<ClientConfig> {
  patch = normalizeIds(patch);
  if (dbEnabled) {
    const existing = await dbGet<ClientConfig>(CLIENTS_TABLE, id);
    if (!existing) throw new Error(`Client '${id}' not found`);
    const updated: ClientConfig = { ...existing, ...patch, id };
    await dbUpsert(CLIENTS_TABLE, id, updated);
    return updated;
  }
  const clients = loadFromFile();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Client '${id}' not found`);
  clients[idx] = { ...clients[idx], ...patch, id };
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
