/**
 * One-time migration: copies clients and schedules from the legacy JSON files
 * into Supabase. Safe to run multiple times — it upserts by id.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run migrate:supabase
 */
import fs from 'fs';
import { CLIENTS_FILE, SCHEDULES_FILE } from '../config/paths';
import { supabase, CLIENTS_TABLE, SCHEDULES_TABLE } from '../config/supabase';

function readJson<T>(file: string): T[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function migrateTable(
  label: string,
  table: string,
  rows: Array<{ id: string }>,
): Promise<void> {
  if (rows.length === 0) {
    console.log(`• ${label}: nada que migrar (archivo vacío o inexistente)`);
    return;
  }
  let ok = 0;
  for (const row of rows) {
    if (!row.id) { console.warn(`  ⚠️  ${label}: registro sin id, omitido`); continue; }
    const { error } = await supabase.from(table).upsert({ id: row.id, data: row });
    if (error) console.error(`  ❌ ${label} ${row.id}: ${error.message}`);
    else { ok++; console.log(`  ✅ ${label}: ${row.id}`); }
  }
  console.log(`• ${label}: ${ok}/${rows.length} migrados`);
}

async function main() {
  console.log('🚚 Migrando datos a Supabase...\n');

  const clients   = readJson<{ id: string }>(CLIENTS_FILE);
  const schedules = readJson<{ id: string }>(SCHEDULES_FILE);

  await migrateTable('clientes',        CLIENTS_TABLE,   clients);
  await migrateTable('automatizaciones', SCHEDULES_TABLE, schedules);

  console.log('\n✅ Migración terminada.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Migración falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
