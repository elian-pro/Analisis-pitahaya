import { pool, dbEnabled, RADAR_SIDECARS_TABLE } from '../config/db';

// ─────────────────────────────────────────────────────────────────────────────
// El sidecar del Radar en la base, para los clientes que no tienen Drive.
//
// runRadarCore leia el sidecar del periodo anterior con findRadarSidecar(), que
// busca un archivo en la carpeta de Drive del cliente. Un cliente externo
// (cliente_pg) no tiene carpeta: sin esto, su Radar sale "primer periodo, sin
// comparativa" todos los meses, para siempre, que es la mitad del valor del
// reporte.
//
// Es el mismo trato que ya tienen los reportes de desempeño, donde el sidecar
// vive en report_metrics.sidecar_text con Drive como respaldo redundante
// (ver routes/report.ts: "un cliente externo no tiene Drive: su comparativo
// vive solo en la base").
//
// Esta tabla NO la toca la purga de 90 dias. Es texto pequeño y es lo que
// sostiene el comparativo: borrarla romperia la comparativa cada trimestre.
// ─────────────────────────────────────────────────────────────────────────────

/** Guarda (o reemplaza) el sidecar de un periodo. Best-effort: nunca lanza. */
export async function saveRadarSidecar(clientId: string, periodKey: string, sidecar: string): Promise<void> {
  if (!dbEnabled || !pool) return;
  try {
    await pool.query(
      `INSERT INTO ${RADAR_SIDECARS_TABLE} (client_id, period_key, sidecar)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id, period_key)
       DO UPDATE SET sidecar = EXCLUDED.sidecar, created_at = now()`,
      [clientId, periodKey, sidecar],
    );
  } catch (e) {
    // El PDF ya se genero y se entrego. Perder el sidecar solo cuesta el
    // comparativo del mes que viene, asi que no se tumba la entrega por esto;
    // pero se registra, porque un fallo sistematico se ve exactamente igual
    // que un cliente que nunca ha generado un Radar. Mismo criterio que
    // recordReportMetrics.
    console.warn(`[radar/sidecar] no se pudo guardar ${clientId}/${periodKey}: ${(e as Error).message}`);
  }
}

/** El sidecar de ese periodo, o undefined si no hay. */
export async function findRadarSidecarInDb(clientId: string, periodKey: string): Promise<string | undefined> {
  if (!dbEnabled || !pool) return undefined;
  try {
    const { rows } = await pool.query<{ sidecar: string }>(
      `SELECT sidecar FROM ${RADAR_SIDECARS_TABLE} WHERE client_id = $1 AND period_key = $2`,
      [clientId, periodKey],
    );
    return rows[0]?.sidecar;
  } catch (e) {
    // Sin comparativo se puede vivir: el Radar sale como linea base. Caerse
    // aqui dejaria al cliente sin reporte por no poder mirar el mes pasado.
    console.warn(`[radar/sidecar] no se pudo leer ${clientId}/${periodKey}: ${(e as Error).message}`);
    return undefined;
  }
}
