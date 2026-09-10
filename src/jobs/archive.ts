import { tenantTarget, ensureReportTables } from '../calls/tenant';
import { quoteIdent } from '../calls/db';

// ─────────────────────────────────────────────────────────────────────────────
// Los reportes entregados a un cliente externo, guardados EN SU PROPIA BASE.
//
// Vive al lado de vault.ts porque son el mismo dominio y hay que leerlos
// juntos: la guarda es la ventana de 30 minutos en memoria para todos, esto es
// la copia duradera de quien no tiene Drive.
//
// Por qué en su base y no en la nuestra: `ensureTenantSchema` ya crea ahí la
// tabla `analisis`, donde Zebra escribe la transcripción literal de cada
// llamada y el veredicto de IA llamada por llamada. El contenido sensible ya
// está en su servidor; el PDF no es más que un render de eso mismo. Tenerlo en
// la base de Zebra era la única pieza que se salía del patrón, y encima la más
// fácil de señalar: el documento entero en un solo blob.
//
// Consecuencia buscada: Zebra no guarda ningún PDF del cliente, así que no hay
// plazo de borrado que prometer ni que incumplir. Cuánto conserva es decisión
// suya, en su disco.
//
// Y una consecuencia de regalo: el aislamiento pasa a ser estructural. Ya no
// hay un `AND client_id = $2` que alguien pueda olvidar — no hay dónde
// equivocarse, porque la base ES el cliente.
//
// La compuerta de quién entra aquí NO está en este archivo: es plan.archivo,
// en clients/manager.ts.
// ─────────────────────────────────────────────────────────────────────────────

// node-pg materializa el bytea entero en un Buffer: no hay streaming. A 1-3 MB
// por reporte estamos cuatro órdenes de magnitud por debajo, pero un tope duro
// evita que un caso raro se lleve el proceso por delante.
const MAX_BYTES = 50 * 1024 * 1024;

export type ArchiveKind = 'analisis' | 'radar';   // mismo vocabulario que ReportKind (schedules/runner.ts)

export interface ArchiveRow {
  id:         string;
  kind:       ArchiveKind;
  period_key: string;
  filename:   string;
  size_bytes: number;
  creado_en:  string;
}

/** Qué pasó al intentar guardar. `ok:false` NO es una excepción: es un aviso. */
export interface ArchiveResult { ok: boolean; motivo?: string }

/**
 * Guarda el PDF en la base del cliente. **Nunca lanza**: archivar es un extra
 * sobre una entrega que ya ocurrió, y si su base no responde lo último que debe
 * pasar es que el reporte falle.
 *
 * Pero sí DEVUELVE el fallo, y eso importa: para un cliente externo esta es la
 * única copia duradera pasados los 30 minutos de la guarda efímera. Tragárselo
 * en silencio era perder el reporte sin que nadie se enterara, así que el
 * llamador se lo dice al cliente y le pide que descargue.
 *
 * `id` es el id del JOB para los reportes: eso permite que la ruta de descarga
 * existente caiga aquí cuando la guarda expira, sin política nueva. Regenerar
 * el mismo job reemplaza la fila en vez de duplicarla.
 */
export async function archivePdf(a: {
  id: string; clientId: string; kind: ArchiveKind;
  periodKey: string; filename: string; pdf: Buffer;
}): Promise<ArchiveResult> {
  if (a.pdf.length > MAX_BYTES) {
    const motivo = `el PDF pesa ${a.pdf.length} B y no cabe (tope ${MAX_BYTES} B)`;
    console.warn(`[archive] ${a.filename}: ${motivo}`);
    return { ok: false, motivo };
  }
  try {
    const { pool, esquema } = await tenantTarget(a.clientId);
    // Perezoso: un cliente aprovisionado antes de que estas tablas existieran
    // no ha vuelto a pulsar "Guardar y preparar".
    await ensureReportTables(pool, esquema);
    await pool.query(
      `INSERT INTO ${quoteIdent(esquema)}.reportes
         (id, kind, period_key, filename, size_bytes, pdf)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         pdf = EXCLUDED.pdf, filename = EXCLUDED.filename,
         size_bytes = EXCLUDED.size_bytes, creado_en = now()`,
      [a.id, a.kind, a.periodKey, a.filename, a.pdf.length, a.pdf],
    );
    return { ok: true };
  } catch (e) {
    const motivo = (e as Error).message;
    console.warn(`[archive] no se pudo guardar ${a.kind} de ${a.clientId}/${a.periodKey}: ${motivo}`);
    return { ok: false, motivo };
  }
}

/** Lo que hay guardado en su base, lo más nuevo primero. Sin los bytes. */
export async function listArchive(clientId: string, limit = 100): Promise<ArchiveRow[]> {
  const { pool, esquema } = await tenantTarget(clientId);
  await ensureReportTables(pool, esquema);
  // Nunca SELECT *: la columna pdf arrastraría megas por un pool de 2
  // conexiones solo para pintar una lista. Enumerar columnas no es estilo, es
  // la diferencia entre tocar el TOAST y no tocarlo.
  const { rows } = await pool.query<ArchiveRow>(
    `SELECT id, kind, period_key, filename, size_bytes, creado_en
       FROM ${quoteIdent(esquema)}.reportes
      ORDER BY creado_en DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Los bytes de un documento suyo. El cliente es obligatorio: sin él no hay base
 * que abrir, así que el caso "admin sin filtro" que tenía la versión anterior
 * ya no existe ni tiene sentido.
 */
export async function readArchive(
  clientId: string, id: string,
): Promise<{ filename: string; pdf: Buffer } | undefined> {
  try {
    const { pool, esquema } = await tenantTarget(clientId);
    const { rows } = await pool.query<{ filename: string; pdf: Buffer }>(
      `SELECT filename, pdf FROM ${quoteIdent(esquema)}.reportes WHERE id = $1`,
      [id],
    );
    return rows[0];
  } catch (e) {
    // Una base caída no es un 500 útil aquí: el llamador responde 404 y el
    // cliente ve "el documento ya no está disponible", que es lo que le pasa.
    console.warn(`[archive] no se pudo leer ${clientId}/${id}: ${(e as Error).message}`);
    return undefined;
  }
}
