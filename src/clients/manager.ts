import crypto from 'crypto';
import { supabase, CLIENTS_TABLE } from '../config/supabase';

export interface ClientConfig {
  id:                      string;
  name:                    string;
  folder_id:               string;
  sidecar_folder_id?:      string;
  spreadsheet_id:          string;
  sheet_id?:               string;
  data_sheet_name:         string;
  advisors_sheet_name?:    string;
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

// Each row stores the full client object in a `data` jsonb column keyed by `id`.
export async function loadClients(): Promise<ClientConfig[]> {
  const { data, error } = await supabase
    .from(CLIENTS_TABLE)
    .select('data')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Supabase loadClients failed: ${error.message}`);
  return (data ?? []).map(r => r.data as ClientConfig);
}

export async function getClient(id: string): Promise<ClientConfig | undefined> {
  const { data, error } = await supabase
    .from(CLIENTS_TABLE)
    .select('data')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Supabase getClient failed: ${error.message}`);
  return data ? (data.data as ClientConfig) : undefined;
}

export async function createClient(input: Omit<ClientConfig, 'id'>): Promise<ClientConfig> {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 28);
  const id   = `${slug}_${crypto.randomBytes(3).toString('hex')}`;
  const client: ClientConfig = { id, ...input };
  const { error } = await supabase.from(CLIENTS_TABLE).insert({ id, data: client });
  if (error) throw new Error(`Supabase createClient failed: ${error.message}`);
  return client;
}

export async function updateClient(
  id: string,
  patch: Partial<Omit<ClientConfig, 'id'>>,
): Promise<ClientConfig> {
  const existing = await getClient(id);
  if (!existing) throw new Error(`Client '${id}' not found`);
  const updated: ClientConfig = { ...existing, ...patch, id };
  const { error } = await supabase
    .from(CLIENTS_TABLE)
    .update({ data: updated, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Supabase updateClient failed: ${error.message}`);
  return updated;
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from(CLIENTS_TABLE).delete().eq('id', id);
  if (error) throw new Error(`Supabase deleteClient failed: ${error.message}`);
}
