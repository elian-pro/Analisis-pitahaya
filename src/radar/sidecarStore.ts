import { tenantTarget, ensureReportTables } from '../calls/tenant';
import { quoteIdent } from '../calls/db';

// ─────────────────────────────────────────────────────────────────────────────
// El sidecar del comparativo de Radar, en la base del propio cliente.
//
// runRadarCore leía el sidecar del periodo anterior con findRadarSidecar(), que
// busca un archivo en la carpeta de Drive del cliente. Un cliente externo
// (cliente_pg) no tiene carpeta: sin esto, su Radar sale "primer periodo, sin
// comparativa" todos los meses, para siempre, que es la mitad del valor del
// reporte.
//
// Vive en SU base y no en la de Zebra por el mismo motivo que los PDF: es un
// resumen derivado de sus llamadas, y sus llamadas y su análisis ya están ahí.
//
// Sin columna client_id: la base ES el cliente.
// ─────────────────────────────────────────────────────────────────────────────

/** Guarda (o reemplaza) el sidecar de un periodo. Best-effort: nunca lanza. */
export async function saveRadarSidecar(clientId: string, periodKey: string, sidecar: string): Promise<void> {
  try {
    const { pool, esquema } = await tenantTarget(clientId);
    await ensureReportTables(pool, esquema);
    await pool.query(
      `INSERT INTO ${quoteIdent(esquema)}.radar_sidecars (period_key, sidecar)
       VALUES ($1, $2)
       ON CONFLICT (period_key)
       DO UPDATE SET sidecar = EXCLUDED.sidecar, creado_en = now()`,
      [periodKey, sidecar],
    );
  } catch (e) {
    // El PDF ya se generó y se entregó. Perder el sidecar solo cuesta el
    // comparativo del mes que viene, así que no se tumba la entrega por esto;
    // pero se registra, porque un fallo sistemático se ve desde fuera
    // exactamente igual que un cliente que nunca ha generado un Radar.
    console.warn(`[radar/sidecar] no se pudo guardar ${clientId}/${periodKey}: ${(e as Error).message}`);
  }
}

/** El sidecar de ese periodo, o undefined si no hay. */
export async function findRadarSidecarInDb(clientId: string, periodKey: string): Promise<string | undefined> {
  try {
    const { pool, esquema } = await tenantTarget(clientId);
    await ensureReportTables(pool, esquema);
    const { rows } = await pool.query<{ sidecar: string }>(
      `SELECT sidecar FROM ${quoteIdent(esquema)}.radar_sidecars WHERE period_key = $1`,
      [periodKey],
    );
    return rows[0]?.sidecar;
  } catch (e) {
    // Sin comparativo se puede vivir: el Radar sale como línea base. Caerse
    // aquí dejaría al cliente sin reporte por no poder mirar el mes pasado.
    console.warn(`[radar/sidecar] no se pudo leer ${clientId}/${periodKey}: ${(e as Error).message}`);
    return undefined;
  }
}
