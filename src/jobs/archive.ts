import { pool, dbEnabled, REPORT_ARCHIVE_TABLE } from '../config/db';

// ─────────────────────────────────────────────────────────────────────────────
// Archivo de PDF de los clientes externos. Vive al lado de vault.ts porque son
// el mismo dominio y hay que leerlos juntos: la guarda es la ventana de 30
// minutos para TODOS, esto es la copia duradera solo para quien no tiene Drive.
//
// Por qué existe: planDeEntrega le da al cliente externo {drive:false,
// vault:true}, o sea que su ÚNICA entrega eran esos 30 minutos. Un reinicio
// antes de que descargara perdía el reporte, y regenerarlo se vuelve a pagar en
// tokens. El equipo decidió conservarlos 90 días y dejar la descarga a cargo
// del cliente.
//
// La compuerta de quién entra aquí NO está en este archivo: es plan.archivo,
// en clients/manager.ts. Aquí no se decide, solo se guarda.
// ─────────────────────────────────────────────────────────────────────────────

/** Ventana de retención. Vive aquí, y no en purge.ts, para que el corte que
 *  borra y el `expires_at` que se le enseña al cliente sean la MISMA cuenta. */
export const RETENCION_DIAS = Number(process.env.PDF_ARCHIVE_DAYS || 90);

// node-pg materializa el bytea entero en un Buffer: no hay streaming. A 1-3 MB
// por reporte estamos cuatro órdenes de magnitud por debajo, pero un tope duro
// evita que un caso raro se lleve el proceso por delante. Mismo criterio que
// PdfVault con su techo de bytes.
const MAX_BYTES = 50 * 1024 * 1024;

export type ArchiveKind = 'analisis' | 'radar';   // mismo vocabulario que ReportKind (schedules/runner.ts)

export interface ArchiveRow {
  id:         string;
  kind:       ArchiveKind;
  period_key: string;
  filename:   string;
  size_bytes: number;
  created_at: string;
}

/**
 * Guarda el PDF. **Nunca lanza**: ese es todo su contrato de fallo. Archivar es
 * un extra sobre una entrega que ya ocurrió; si la base está caída, el cliente
 * ya tiene su descarga y lo último que debe pasar es que el reporte falle por
 * no poder guardarse una copia. Mismo razonamiento que recordReportMetrics.
 *
 * `id` es el id del JOB para los reportes: eso es lo que permite que la ruta de
 * descarga existente caiga aquí cuando la guarda efímera expira, sin política
 * nueva. Regenerar el mismo job reemplaza la fila en vez de duplicarla, igual
 * que hace la guarda, y estrena los 90 días.
 */
export async function archivePdf(a: {
  id: string; clientId: string; kind: ArchiveKind;
  periodKey: string; filename: string; pdf: Buffer;
}): Promise<void> {
  if (!dbEnabled || !pool) return;
  if (a.pdf.length > MAX_BYTES) {
    console.warn(`[archive] ${a.filename} pesa ${a.pdf.length} B y no cabe (tope ${MAX_BYTES} B): no se archiva`);
    return;
  }
  try {
    await pool.query(
      `INSERT INTO ${REPORT_ARCHIVE_TABLE} (id, client_id, kind, period_key, filename, size_bytes, pdf)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         pdf = EXCLUDED.pdf, filename = EXCLUDED.filename,
         size_bytes = EXCLUDED.size_bytes, created_at = now()`,
      [a.id, a.clientId, a.kind, a.periodKey, a.filename, a.pdf.length, a.pdf],
    );
  } catch (e) {
    // Se registra fuerte: un fallo sistemático aquí se ve, desde fuera,
    // exactamente igual que un cliente que nunca ha generado nada.
    console.warn(`[archive] no se pudo archivar ${a.kind} ${a.clientId}/${a.periodKey}: ${(e as Error).message}`);
  }
}

/** Lo que hay archivado de un cliente, lo más nuevo primero. Sin los bytes. */
export async function listArchive(clientId: string, limit = 100): Promise<ArchiveRow[]> {
  if (!dbEnabled || !pool) return [];
  // Nunca SELECT *: la columna pdf arrastraría cientos de MB por un pool de 5
  // conexiones solo para pintar una lista. Enumerar columnas no es estilo, es
  // la diferencia entre tocar el TOAST y no tocarlo.
  const { rows } = await pool.query<ArchiveRow>(
    `SELECT id, kind, period_key, filename, size_bytes, created_at
       FROM ${REPORT_ARCHIVE_TABLE}
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [clientId, limit],
  );
  return rows;
}

/**
 * Los bytes de un documento. `clientId` null = admin, sin filtro.
 *
 * El filtro va DENTRO del SQL a propósito: así "no existe" y "no es tuyo" son
 * indistinguibles desde una sola consulta, y el llamador responde 404 en los dos
 * casos. Es la misma regla deliberada que el middleware aplica a un job ajeno:
 * un 403 confirmaría que el documento de otro cliente existe.
 */
export async function readArchive(
  id: string, clientId: string | null,
): Promise<{ filename: string; pdf: Buffer } | undefined> {
  if (!dbEnabled || !pool) return undefined;
  const { rows } = await pool.query<{ filename: string; pdf: Buffer }>(
    `SELECT filename, pdf FROM ${REPORT_ARCHIVE_TABLE}
      WHERE id = $1 AND ($2::text IS NULL OR client_id = $2)`,
    [id, clientId],
  );
  return rows[0];
}
