/**
 * One-time migration: copies clients and schedules from the legacy JSON files
 * into PostgreSQL. Safe to run multiple times — it upserts by id.
 *
 * The app also seeds automatically on first boot (see server bootstrap), so this
 * script is only needed if you want to run the migration explicitly, e.g. from a
 * local machine pointed at the production database:
 *
 *   DATABASE_URL=postgres://... npm run migrate:db
 */
import fs from 'fs';
import { CLIENTS_FILE, SCHEDULES_FILE } from '../config/paths';
import {
  dbEnabled,
  ensureSchema,
  pool,
  CLIENTS_TABLE,
  SCHEDULES_TABLE,
  dbUpsert,
} from '../config/db';

function readJson<T extends { id?: string }>(file: string): T[] {
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
  rows: Array<{ id?: string }>,
): Promise<void> {
  if (rows.length === 0) {
    console.log(`• ${label}: nada que migrar (archivo vacío o inexistente)`);
    return;
  }
  let ok = 0;
  for (const row of rows) {
    if (!row.id) { console.warn(`  ⚠️  ${label}: registro sin id, omitido`); continue; }
    try {
      await dbUpsert(table, row.id, row);
      ok++;
      console.log(`  ✅ ${label}: ${row.id}`);
    } catch (e) {
      console.error(`  ❌ ${label} ${row.id}: ${(e as Error).message}`);
    }
  }
  console.log(`• ${label}: ${ok}/${rows.length} migrados`);
}

async function main(): Promise<void> {
  if (!dbEnabled) {
    console.error('❌ DATABASE_URL no está configurada. Define la variable y vuelve a intentar.');
    process.exit(1);
  }

  console.log('🚚 Migrando datos a PostgreSQL...\n');
  await ensureSchema();

  const clients   = readJson<{ id?: string }>(CLIENTS_FILE);
  const schedules = readJson<{ id?: string }>(SCHEDULES_FILE);

  await migrateTable('clientes',         CLIENTS_TABLE,   clients);
  await migrateTable('automatizaciones', SCHEDULES_TABLE, schedules);

  console.log('\n✅ Migración terminada.');
  await pool?.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Migración falló:', err instanceof Error ? err.message : err);
  await pool?.end();
  process.exit(1);
});
