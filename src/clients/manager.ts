import fs from 'fs';
import crypto from 'crypto';
import { CLIENTS_FILE } from '../config/paths';

export interface ClientConfig {
  id:                      string;
  name:                    string;
  folder_id:               string;
  sidecar_folder_id?:      string;
  spreadsheet_id:          string;
  data_sheet_name:         string;
  col_fecha:               string;
  col_asesor:              string;
  col_calif:               string;
  col_analisis:            string;
  col_transcripcion:       string;
  col_duracion?:           string;
  excluded_phrases:        string[];
  transcripcion_max_chars: number;
  prompt_individual:       string;
  prompt_general:          string;
}


export function loadClients(): ClientConfig[] {
  try { return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8')); }
  catch { return []; }
}

function saveClients(clients: ClientConfig[]): void {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');
}

export function getClient(id: string): ClientConfig | undefined {
  return loadClients().find(c => c.id === id);
}

export function createClient(data: Omit<ClientConfig, 'id'>): ClientConfig {
  const clients = loadClients();
  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 28);
  const id   = `${slug}_${crypto.randomBytes(3).toString('hex')}`;
  const client: ClientConfig = { id, ...data };
  clients.push(client);
  saveClients(clients);
  return client;
}

export function updateClient(id: string, patch: Partial<Omit<ClientConfig, 'id'>>): ClientConfig {
  const clients = loadClients();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Client '${id}' not found`);
  clients[idx] = { ...clients[idx], ...patch };
  saveClients(clients);
  return clients[idx];
}

export function deleteClient(id: string): void {
  const clients = loadClients();
  const idx = clients.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Client '${id}' not found`);
  clients.splice(idx, 1);
  saveClients(clients);
}
