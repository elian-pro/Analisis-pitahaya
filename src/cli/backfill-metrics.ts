/**
 * Reconstruye report_metrics a partir de los sidecars de Drive.
 *
 * Hasta el arreglo del redondeo (ver metrics/store.ts), un pct_siguiente o un
 * talk_ratio con decimales reventaba el INSERT contra una columna INTEGER y el
 * error se tragaba en silencio: el reporte se entregaba, el sidecar quedaba en
 * Drive, y la fila de métricas no se escribía nunca. Este comando recupera esos
 * periodos leyendo los sidecars, que son la copia que sí sobrevivió.
 *
 *   npm run backfill:metrics -- --dry-run          # todos los clientes, sin escribir
 *   npm run backfill:metrics -- sofia_fractional_residences
 *
 * Es idempotente: nunca pisa una fila existente (ON CONFLICT DO NOTHING), así
 * que se puede volver a correr sin miedo.
 */
import { dbEnabled } from '../config/db';
import { loadClients, type ClientConfig } from '../clients/manager';
import { findSidecarFolder, listSidecars } from '../google/drive';
import { parseSidecarMetrics } from '../claude/individual';
import { insertMetricsIfAbsent } from '../metrics/store';

// "Sidecar_Ana Lopez_2026-05.txt" → { advisor: 'Ana Lopez', periodKey: '2026-05' }
// El periodo va al final y nunca lleva guion bajo, así que el resto es el nombre
// del asesor aunque este contenga espacios o guiones.
export function parseSidecarName(fileName: string): { advisor: string; periodKey: string } | null {
  const m = fileName.match(/^Sidecar_(.+)_(\d{4}-\d{2}(?:-\d{2})?)(?:\.txt)?$/);
  return m ? { advisor: m[1], periodKey: m[2] } : null;
}

async function backfillClient(client: ClientConfig, dryRun: boolean): Promise<void> {
  const folderId = client.sidecar_folder_id
    ?? (client.folder_id ? await findSidecarFolder(client.folder_id) : null);
  if (!folderId) {
    console.log(`· ${client.name}: sin carpeta de sidecars, se omite`);
    return;
  }

  const files = await listSidecars(folderId);
  let escritas = 0, yaEstaban = 0, ilegibles = 0;

  for (const f of files) {
    const parsed = parseSidecarName(f.name);
    const metrics = parseSidecarMetrics(f.text);
    if (!parsed || !metrics) { ilegibles++; continue; }

    if (dryRun) { escritas++; continue; }
    const inserted = await insertMetricsIfAbsent(
      client.id, parsed.advisor, parsed.periodKey,
      metrics.avg_score, metrics.pct_logra_siguiente_paso, metrics.talk_ratio, f.text,
    );
    if (inserted) escritas++; else yaEstaban++;
  }

  console.log(
    `· ${client.name}: ${files.length} sidecar(s) · ` +
    `${escritas} ${dryRun ? 'se escribirían' : 'escritas'} · ${yaEstaban} ya estaban · ${ilegibles} ilegibles`,
  );
}

async function main(): Promise<void> {
  const args    = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const only    = args.find(a => !a.startsWith('--'));

  if (!dbEnabled) {
    console.error('❌ Falta DATABASE_URL: sin base no hay nada que rellenar.');
    process.exit(1);
  }

  const clients = (await loadClients()).filter(c => !only || c.id === only);
  if (clients.length === 0) {
    console.error(only ? `❌ Cliente '${only}' no encontrado.` : '❌ No hay clientes configurados.');
    process.exit(1);
  }

  console.log(`Backfill de report_metrics${dryRun ? ' (dry-run, no escribe)' : ''} · ${clients.length} cliente(s)\n`);
  for (const client of clients) {
    try {
      await backfillClient(client, dryRun);
    } catch (e) {
      console.error(`· ${client.name}: FALLÓ — ${(e as Error).message}`);
    }
  }
  console.log('\nListo.');
  process.exit(0);
}

// Solo corre cuando se invoca como comando: así el módulo se puede importar
// desde los tests sin que se dispare el backfill.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
