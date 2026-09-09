import { pool, dbEnabled, REPORT_ARCHIVE_TABLE, JOBS_TABLE } from '../config/db';
import { RETENCION_DIAS } from './archive';
import { loadClients } from '../clients/manager';

// ─────────────────────────────────────────────────────────────────────────────
// Purga del archivo de PDF. Pasados los 90 días se borran, sin excepción: eso
// es lo que se le prometió al cliente, y una promesa de borrado que a veces no
// se cumple es peor que no haberla hecho.
//
// Forma copiada del barrido de llamadas (calls/sweeper.ts): guarda de
// reentrada, setInterval, una pasada inmediata y su gemela para pararlo. NO se
// monta sobre el scheduler de Automatización, que está atado a un client_id y a
// semántica de reportes: una tarea interna no tiene cliente al que pertenecer.
//
// Lo que NO se purga, a propósito: report_metrics y radar_sidecars. Son texto
// pequeño y son lo que sostiene el comparativo periodo-a-periodo; borrarlos a
// los 90 días dejaría a cada cliente sin comparativa cada trimestre.
// ─────────────────────────────────────────────────────────────────────────────

const INTERVALO_MS = 60 * 60 * 1000;   // una hora: la ventana es de 90 días

let _interval: NodeJS.Timeout | null = null;
let _corriendo = false;

/** Si el tick está vivo en ESTE proceso. Lo publica /api/health. */
export const purgaCorriendo = (): boolean => _interval !== null;

/**
 * Todo lo creado ANTES de esto se borra. Pura y con reloj inyectable: es lo
 * único de aquí que se puede probar sin base, y es la misma cuenta que produce
 * el `expires_at` que ve el cliente. Que la UI prometa un corte y el DELETE
 * aplique otro es un bug esperando a un cambio de horario.
 */
export function corteRetencion(ahora: number, dias = RETENCION_DIAS): Date {
  return new Date(ahora - dias * 24 * 60 * 60 * 1000);
}

/** Una pasada. Devuelve cuántas filas cayeron de cada cosa. */
export async function purgeOnce(now: () => number = Date.now): Promise<{ pdfs: number; jobs: number }> {
  if (!dbEnabled || !pool) return { pdfs: 0, jobs: 0 };
  if (_corriendo) return { pdfs: 0, jobs: 0 };
  _corriendo = true;
  const corte = corteRetencion(now());
  try {
    const pdfs = await pool.query(
      `DELETE FROM ${REPORT_ARCHIVE_TABLE} WHERE created_at < $1`, [corte],
    );

    // Los registros de job del cliente externo caen con sus PDF: dejar la ficha
    // (cliente, mes, asesores) viva para siempre mientras se borra el documento
    // deja la promesa a medias. Solo los externos: el job de un gestionado es
    // la trazabilidad de un reporte que sigue existiendo en su Drive.
    const externos = (await loadClients())
      .filter(c => c.calls_source === 'cliente_pg')
      .map(c => c.id);
    const jobs = externos.length
      ? await pool.query(
          `DELETE FROM ${JOBS_TABLE} WHERE created_at < $1 AND data->>'client_id' = ANY($2)`,
          [corte, externos],
        )
      : { rowCount: 0 };

    const borrados = { pdfs: pdfs.rowCount ?? 0, jobs: jobs.rowCount ?? 0 };
    if (borrados.pdfs || borrados.jobs) {
      console.log(`[purge] ${borrados.pdfs} documento(s) y ${borrados.jobs} job(s) borrados (corte ${corte.toISOString()})`);
    }
    return borrados;
  } catch (e) {
    // Un tick fallido no puede matar el intervalo: la base puede estar caída un
    // minuto y el borrado de mañana debe seguir ocurriendo.
    console.warn(`[purge] pasada fallida: ${(e as Error).message}`);
    return { pdfs: 0, jobs: 0 };
  } finally {
    _corriendo = false;
  }
}

export function startPdfPurge(): void {
  if (_interval) return;
  _interval = setInterval(() => { void purgeOnce(); }, INTERVALO_MS);
  void purgeOnce();
  console.log(`[purge] retencion activa (${RETENCION_DIAS} dias, revision cada hora)`);
}

export function stopPdfPurge(): void {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
