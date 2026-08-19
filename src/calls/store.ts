import { dbEnabled, pool, CALLS_TABLE } from '../config/db';
import { humanizeError } from '../humanizeError';
import type { NormalizedCall } from './normalize';

// ─────────────────────────────────────────────────────────────────────────────
// Acceso a la tabla `calls`.
//
// La tabla ES la cola: el estado del pipeline vive en columnas, no en memoria.
// Por eso un reinicio no pierde trabajo, a diferencia de jobs/store.ts, que
// marca como error todo lo que estuviera en vuelo (ver initJobs()).
//
// A diferencia del resto de stores del repo, aquí NO hay respaldo en JSON: el
// pipeline de llamadas nace para Postgres y un fallback a fichero solo serviría
// para perder datos en silencio.
// ─────────────────────────────────────────────────────────────────────────────

export type CallEstado =
  | 'recibida' | 'descartada' | 'transcrita' | 'analizada' | 'fallida' | 'sin_asignar';

/** Estados desde los que aún queda trabajo por hacer. Coincide con el índice parcial. */
export const ESTADOS_PENDIENTES: CallEstado[] = ['recibida', 'transcrita', 'fallida'];

export interface CallRow {
  call_id:           string;
  client_id:         string | null;
  fecha:             Date;
  asesor:            string;
  callee_number:     string | null;
  callee_city:       string | null;
  callee_state:      string | null;
  call_status:       string | null;
  wait_time:         number | null;
  duracion_segundos: number;
  record:            string | null;
  raw:               unknown;
  procesado_at:      Date | null;
  lead_id:           string | null;
  tipo_contacto:     string | null;
  presentacion:      string | null;
  precalif:          string | null;
  exploracion:       string | null;
  agenda:            string | null;
  analisis:          string | null;
  transcripcion:     string | null;
  estado:            CallEstado;
  error:             string | null;
  intentos:          number;
  calif_global:      number | null;
}

function db() {
  if (!dbEnabled || !pool) {
    throw new Error(
      'El pipeline de llamadas necesita PostgreSQL. Configura DATABASE_URL para usarlo.',
    );
  }
  return pool;
}

/**
 * Guarda el evento recién recibido. Idempotente por `call_id`: reenviar el mismo
 * webhook no duplica la fila ni vuelve a pagar la transcripción — exactamente lo
 * que hoy no puede garantizar n8n, que hace `append` sin clave.
 *
 * Devuelve true si insertó, false si ya existía.
 */
export async function insertCall(
  call:     NormalizedCall,
  clientId: string | null,
  estado:   CallEstado,
  error:    string | null = null,
): Promise<boolean> {
  const { rowCount } = await db().query(
    `INSERT INTO ${CALLS_TABLE} (
       call_id, client_id, fecha, asesor, callee_number, callee_city, callee_state,
       call_status, wait_time, duracion_segundos, record, raw, estado, error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (call_id) DO NOTHING`,
    [
      call.call_id, clientId, call.fecha, call.asesor, call.callee_number,
      call.callee_city, call.callee_state, call.call_status, call.wait_time,
      call.duracion_segundos, call.record, JSON.stringify(call.raw), estado, error,
    ],
  );
  return rowCount === 1;
}

export async function getCall(callId: string): Promise<CallRow | undefined> {
  const { rows } = await db().query(`SELECT * FROM ${CALLS_TABLE} WHERE call_id = $1`, [callId]);
  return rows[0] as CallRow | undefined;
}

export interface ListFilters {
  client_id?: string;
  estado?:    CallEstado;
  from?:      string;   // YYYY-MM-DD
  to?:        string;   // YYYY-MM-DD
  limit?:     number;
}

export async function listCalls(f: ListFilters = {}): Promise<CallRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };

  if (f.client_id) add('client_id = ?', f.client_id);
  if (f.estado)    add('estado = ?', f.estado);
  if (f.from)      add('fecha >= ?', `${f.from}T00:00:00`);
  if (f.to)        add('fecha <= ?', `${f.to}T23:59:59`);

  args.push(Math.min(f.limit ?? 200, 1000));
  const { rows } = await db().query(
    `SELECT * FROM ${CALLS_TABLE}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY fecha DESC LIMIT $${args.length}`,
    args,
  );
  return rows as CallRow[];
}

/**
 * Lo que al barrido le queda por hacer. El tope de `intentos` es lo que impide
 * que un fallo permanente (audio borrado, cuota agotada) se reintente para
 * siempre pagando una transcripción en cada vuelta.
 */
export async function listPendientes(maxIntentos = 3, limit = 20): Promise<CallRow[]> {
  const { rows } = await db().query(
    `SELECT * FROM ${CALLS_TABLE}
      WHERE estado = ANY($1) AND intentos < $2
      ORDER BY fecha ASC LIMIT $3`,
    [ESTADOS_PENDIENTES, maxIntentos, limit],
  );
  return rows as CallRow[];
}

export async function markTranscrita(callId: string, transcripcion: string): Promise<void> {
  await db().query(
    `UPDATE ${CALLS_TABLE}
        SET transcripcion = $2, estado = 'transcrita', error = NULL
      WHERE call_id = $1`,
    [callId, transcripcion],
  );
}

export interface AnalysisFields {
  tipo_contacto: string | null;
  presentacion:  string | null;
  precalif:      string | null;
  exploracion:   string | null;
  agenda:        string | null;
  analisis:      string | null;
}

/**
 * Cierra la llamada. No escribe `calif_global`: esa columna es GENERATED y la
 * calcula Postgres a partir de los cuatro campos de aquí — el mismo cálculo que
 * hacía la ArrayFormula del Sheet, sin el bug que premiaba "Whatsapp".
 */
export async function markAnalizada(callId: string, a: AnalysisFields): Promise<void> {
  await db().query(
    `UPDATE ${CALLS_TABLE}
        SET tipo_contacto = $2, presentacion = $3, precalif = $4, exploracion = $5,
            agenda = $6, analisis = $7,
            estado = 'analizada', error = NULL, procesado_at = now()
      WHERE call_id = $1`,
    [callId, a.tipo_contacto, a.presentacion, a.precalif, a.exploracion, a.agenda, a.analisis],
  );
}

/** Buzón de voz: termina el recorrido sin pasar por el análisis. */
export async function markBuzon(callId: string, transcripcion: string): Promise<void> {
  await db().query(
    `UPDATE ${CALLS_TABLE}
        SET transcripcion = $2, analisis = 'Buzón de voz', estado = 'analizada',
            error = NULL, procesado_at = now()
      WHERE call_id = $1`,
    [callId, transcripcion],
  );
}

export async function markDescartada(callId: string, motivo: string): Promise<void> {
  await db().query(
    `UPDATE ${CALLS_TABLE}
        SET estado = 'descartada', error = $2, procesado_at = now()
      WHERE call_id = $1`,
    [callId, motivo],
  );
}

/** El mensaje se guarda ya traducido, igual que hace jobs/store.ts en updateJob. */
export async function markFallida(callId: string, err: unknown): Promise<void> {
  const msg = humanizeError(err instanceof Error ? err.message : String(err));
  await db().query(
    `UPDATE ${CALLS_TABLE}
        SET estado = 'fallida', error = $2, intentos = intentos + 1
      WHERE call_id = $1`,
    [callId, msg],
  );
}

/** Asigna el cliente de una llamada que llegó sin poder resolverse. */
export async function assignClient(callId: string, clientId: string): Promise<void> {
  await db().query(
    `UPDATE ${CALLS_TABLE}
        SET client_id = $2, estado = CASE WHEN estado = 'sin_asignar' THEN 'recibida' ELSE estado END
      WHERE call_id = $1`,
    [callId, clientId],
  );
}

/** Conteo por estado para la cabecera del monitoreo. */
export async function countByEstado(clientId?: string): Promise<Record<string, number>> {
  const { rows } = await db().query(
    `SELECT estado, COUNT(*)::int AS n FROM ${CALLS_TABLE}
     ${clientId ? 'WHERE client_id = $1' : ''}
     GROUP BY estado`,
    clientId ? [clientId] : [],
  );
  return Object.fromEntries(rows.map(r => [r.estado, r.n]));
}
