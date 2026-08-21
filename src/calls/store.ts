import { callsDb } from './db';
import { humanizeError } from '../humanizeError';
import { esquemaDe, type Cuenta } from './registry';

// ─────────────────────────────────────────────────────────────────────────────
// Acceso a `<schema>.llamadas` (la escribe Callpicker, aquí solo se lee) y a
// `<schema>.analisis` (la escribimos nosotros).
//
// `analisis` NO duplica fecha, asesor ni teléfono: viven en `llamadas` y ambas
// tablas están en la misma base, así que se unen al leer. La hoja de Sheets sí
// los repetía porque allí no había joins.
//
// La clave es compuesta (cuenta, call_id) igual que en `llamadas`: call_id no
// es único por sí solo, va namespaced por cuenta.
// ─────────────────────────────────────────────────────────────────────────────

export type CallEstado = 'pendiente' | 'descartada' | 'transcrita' | 'analizada' | 'fallida';

/**
 * Lo que ve la pestaña. Además de los estados reales de `analisis` hay dos que
 * se derivan de la propia llamada:
 *   • 'sin_procesar' — supera el umbral y todavía no tiene fila de análisis.
 *   • 'corta'        — no llega al umbral, así que el pipeline no la mirará.
 * Sin esa distinción las 1.200 llamadas de menos de 100 s aparecían como
 * pendientes y el monitoreo no servía para nada.
 */
export type CallEstadoUI = CallEstado | 'sin_procesar' | 'corta';

export const ESTADOS_PENDIENTES: CallEstado[] = ['pendiente', 'transcrita', 'fallida'];

/** Una llamada con su análisis, tal como la ve la pestaña. */
export interface CallRow {
  cuenta:        string;
  call_id:       string;
  fecha:         Date;
  asesor:        string | null;
  contraparte_numero: string | null;
  ciudad:        string | null;
  duracion_seg:  number | null;
  estatus:       string | null;
  record:        string | null;
  estado:        CallEstadoUI;
  transcripcion: string | null;
  tipo_contacto: string | null;
  presentacion:  string | null;
  precalif:      string | null;
  exploracion:   string | null;
  agenda:        string | null;
  analisis:      string | null;
  calif_global:  number | null;
  error:         string | null;
  intentos:      number | null;
  procesado_at:  Date | null;
}

// Columnas de la llamada + las del análisis. `grabaciones[1]` es la URL del
// audio: la columna es un ARRAY de Postgres, no el string JSON que llegaba en
// Sheets, así que no hay nada que parsear.
const SELECT_BASE = (esq: string, umbralParam: string) => `
  SELECT l.cuenta, l.call_id, l.fecha, l.asesor, l.contraparte_numero, l.ciudad,
         l.duracion_seg, l.estatus, l.grabaciones[1] AS record,
         COALESCE(a.estado,
                  CASE WHEN l.duracion_seg >= ${umbralParam} THEN 'sin_procesar' ELSE 'corta' END
         ) AS estado,
         a.transcripcion, a.tipo_contacto, a.presentacion, a.precalif,
         a.exploracion, a.agenda, a.analisis, a.calif_global, a.error,
         a.intentos, a.procesado_at
    FROM ${esq}.llamadas l
    LEFT JOIN ${esq}.analisis a
           ON a.cuenta = l.cuenta AND a.call_id = l.call_id`;

export interface PendientesOpts {
  minDuracion?:  number;
  desde?:        string;   // YYYY-MM-DD, en hora de México
  maxIntentos?:  number;
  limit?:        number;
}

/**
 * Lo que falta por procesar: llamadas con audio, suficientemente largas, que o
 * no tienen fila en `analisis` o la tienen a medias.
 *
 * El corte por fecha se hace en hora de México y no en UTC: `fecha` es
 * timestamptz, y con UTC las llamadas del 31 por la tarde caerían en el mes
 * siguiente.
 */
export async function listPendientes(c: Cuenta, o: PendientesOpts = {}): Promise<CallRow[]> {
  const esq = esquemaDe(c);
  const { rows } = await callsDb().query(
    `${SELECT_BASE(esq, '$1')}
      WHERE l.n_grabaciones > 0
        AND l.duracion_seg >= $1
        AND (a.estado IS NULL OR (a.estado = ANY($2) AND a.intentos < $3))
        AND ($4::date IS NULL OR (l.fecha AT TIME ZONE 'America/Mexico_City') >= $4::date)
      ORDER BY l.fecha ASC
      LIMIT $5`,
    [o.minDuracion ?? 100, ESTADOS_PENDIENTES, o.maxIntentos ?? 3, o.desde ?? null, o.limit ?? 20],
  );
  return rows as CallRow[];
}

export interface ListFilters {
  estado?:      CallEstadoUI;
  desde?:       string;
  hasta?:       string;
  limit?:       number;
  minDuracion?: number;
}

/** Para la pestaña: todas las llamadas con audio del periodo, procesadas o no. */
export async function listCalls(c: Cuenta, f: ListFilters = {}): Promise<CallRow[]> {
  const esq = esquemaDe(c);
  const args: unknown[] = [f.minDuracion ?? 100];      // $1 = umbral
  const where = ['l.n_grabaciones > 0'];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };

  if (f.desde) add(`(l.fecha AT TIME ZONE 'America/Mexico_City') >= ?::date`, f.desde);
  if (f.hasta) add(`(l.fecha AT TIME ZONE 'America/Mexico_City') <  (?::date + 1)`, f.hasta);

  if (f.estado === 'corta')             where.push('a.estado IS NULL AND l.duracion_seg < $1');
  else if (f.estado === 'sin_procesar') where.push('a.estado IS NULL AND l.duracion_seg >= $1');
  else if (f.estado)                    add('a.estado = ?', f.estado);
  // Por defecto se ocultan las cortas: son el 95 % de las filas y el pipeline no
  // las va a tocar nunca. Se ven pidiendo el estado 'corta' explícitamente.
  else where.push('(a.estado IS NOT NULL OR l.duracion_seg >= $1)');

  args.push(Math.min(f.limit ?? 200, 1000));
  const { rows } = await callsDb().query(
    `${SELECT_BASE(esq, '$1')} WHERE ${where.join(' AND ')} ORDER BY l.fecha DESC LIMIT $${args.length}`,
    args,
  );
  return rows as CallRow[];
}

export async function getCall(c: Cuenta, callId: string): Promise<CallRow | undefined> {
  const { rows } = await callsDb().query(
    `${SELECT_BASE(esquemaDe(c), '0')} WHERE l.call_id = $1 LIMIT 1`, [callId]);
  return rows[0] as CallRow | undefined;
}

// ── Escrituras ───────────────────────────────────────────────────────────────
// Todas hacen upsert: la fila de `analisis` puede no existir todavía (la llamada
// la creó Callpicker, no nosotros), así que no se puede asumir un UPDATE.

const upsert = (esq: string, cols: string, sets: string) => `
  INSERT INTO ${esq}.analisis (cuenta, call_id, ${cols})
  VALUES ($1, $2, ${cols.split(',').map((_, i) => `$${i + 3}`).join(', ')})
  ON CONFLICT (cuenta, call_id) DO UPDATE SET ${sets}`;

export async function markTranscrita(c: Cuenta, callId: string, texto: string): Promise<void> {
  await callsDb().query(
    upsert(esquemaDe(c), 'estado, transcripcion',
           `estado = 'transcrita', transcripcion = EXCLUDED.transcripcion, error = NULL`),
    [c.slug, callId, 'transcrita', texto]);
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
 * Cierra la llamada. No escribe `calif_global`: es una columna GENERATED que
 * calcula Postgres desde los cuatro campos de arriba, con la fórmula del Sheet
 * ya corregida (verificada contra el motor: "Whatsapp" da 0, no 35).
 */
export async function markAnalizada(c: Cuenta, callId: string, a: AnalysisFields): Promise<void> {
  await callsDb().query(
    upsert(esquemaDe(c),
      'estado, tipo_contacto, presentacion, precalif, exploracion, agenda, analisis',
      `estado = 'analizada', tipo_contacto = EXCLUDED.tipo_contacto,
       presentacion = EXCLUDED.presentacion, precalif = EXCLUDED.precalif,
       exploracion = EXCLUDED.exploracion, agenda = EXCLUDED.agenda,
       analisis = EXCLUDED.analisis, error = NULL, procesado_at = now()`),
    [c.slug, callId, 'analizada', a.tipo_contacto, a.presentacion, a.precalif,
     a.exploracion, a.agenda, a.analisis]);
}

/** Buzón de voz: termina sin pasar por el análisis, que no tendría nada que leer. */
export async function markBuzon(c: Cuenta, callId: string, texto: string): Promise<void> {
  await callsDb().query(
    upsert(esquemaDe(c), 'estado, transcripcion, analisis',
      `estado = 'analizada', transcripcion = EXCLUDED.transcripcion,
       analisis = 'Buzón de voz', error = NULL, procesado_at = now()`),
    [c.slug, callId, 'analizada', texto, 'Buzón de voz']);
}

export async function markFallida(c: Cuenta, callId: string, err: unknown): Promise<void> {
  const msg = humanizeError(err instanceof Error ? err.message : String(err));
  await callsDb().query(
    upsert(esquemaDe(c), 'estado, error, intentos',
      `estado = 'fallida', error = EXCLUDED.error,
       intentos = ${esquemaDe(c)}.analisis.intentos + 1`),
    [c.slug, callId, 'fallida', msg, 1]);
}

/**
 * Los asesores que aparecen en las llamadas del periodo configurado, con cuántas
 * tiene cada uno.
 *
 * Con el filtro de fecha, que es lo que lo hace útil: `listEsquemas` saca los
 * nombres de la tabla entera, así que ahí salen los que se fueron hace dos años
 * y cualquier aviso construido sobre esa lista se vuelve ruido a la tercera vez.
 */
export async function asesoresDelPeriodo(
  c: Cuenta, desde?: string, minDuracion = 100,
): Promise<Array<{ asesor: string; n: number }>> {
  const { rows } = await callsDb().query(
    `SELECT btrim(l.asesor) AS asesor, count(*)::int AS n
       FROM ${esquemaDe(c)}.llamadas l
      WHERE l.asesor IS NOT NULL AND btrim(l.asesor) <> ''
        AND l.n_grabaciones > 0 AND l.duracion_seg >= $2
        AND ($1::date IS NULL OR (l.fecha AT TIME ZONE 'America/Mexico_City') >= $1::date)
      GROUP BY 1 ORDER BY 2 DESC`,
    [desde ?? null, minDuracion]);
  return rows as Array<{ asesor: string; n: number }>;
}

/** Resumen por estado para la cabecera de la pestaña. */
export async function countByEstado(
  c: Cuenta, desde?: string, minDuracion = 100,
): Promise<Record<string, number>> {
  const esq = esquemaDe(c);
  const { rows } = await callsDb().query(
    `SELECT COALESCE(a.estado,
              CASE WHEN l.duracion_seg >= $2 THEN 'sin_procesar' ELSE 'corta' END) AS estado,
            count(*)::int AS n
       FROM ${esq}.llamadas l
       LEFT JOIN ${esq}.analisis a ON a.cuenta = l.cuenta AND a.call_id = l.call_id
      WHERE l.n_grabaciones > 0
        AND ($1::date IS NULL OR (l.fecha AT TIME ZONE 'America/Mexico_City') >= $1::date)
      GROUP BY 1`,
    [desde ?? null, minDuracion]);
  return Object.fromEntries(rows.map(r => [r.estado, r.n]));
}
