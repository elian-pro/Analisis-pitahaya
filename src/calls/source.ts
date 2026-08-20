import { callsDb, quoteIdent } from './db';
import type { CallRow as SheetCallRow } from '../google/sheets';

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de llamadas para los REPORTES desde Postgres.
//
// Devuelve exactamente la misma forma que getCallData() de google/sheets.ts, y
// eso es deliberado: jobs/runner y radar/dbFlow consumen `CallRow[]` y no tienen
// por qué enterarse de dónde salió. Cambiar la fuente de un cliente pasa a ser
// elegir qué función llamar, no reescribir el flujo del reporte.
//
// Ojo con la diferencia de origen: en Sheets el análisis y la calificación los
// escribía n8n en la hoja; aquí salen de `analisis`, que llena este pipeline.
// Una llamada sin analizar todavía no aparece — igual que una fila que n8n aún
// no había escrito.
// ─────────────────────────────────────────────────────────────────────────────

export type { SheetCallRow as CallRow };

export interface DbCallQuery {
  /** Schema donde viven `llamadas` y `analisis`. */
  esquema:      string;
  /** Solo estos asesores. Es lo que separa a dos clientes que comparten cuenta. */
  roster?:      string[];
  month?:       string;   // YYYY-MM
  dateFrom?:    string;   // YYYY-MM-DD
  dateTo?:      string;   // YYYY-MM-DD
  minDuracion?: number;
  maxChars?:    number;
  excluded?:    string[];
}

/**
 * Las llamadas analizadas de un periodo, listas para el reporte.
 *
 * El filtro por asesor va en SQL y no en memoria porque una cuenta compartida
 * puede tener miles de llamadas de otro equipo, y traerlas para descartarlas
 * después sería mover datos para nada. El emparejamiento imita a
 * advisors/match.ts: sin distinguir mayúsculas y sin espacios sobrantes.
 */
export async function getCallDataFromDb(q: DbCallQuery): Promise<SheetCallRow[]> {
  const esq = quoteIdent(q.esquema);
  const where: string[] = [
    "a.estado = 'analizada'",
    'l.n_grabaciones > 0',
    'l.duracion_seg >= $1',
  ];
  const args: unknown[] = [q.minDuracion ?? 100];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };

  // El corte se hace en hora de México: con UTC, una llamada del día 31 por la
  // tarde caería en el mes siguiente.
  const TZ = "(l.fecha AT TIME ZONE 'America/Mexico_City')";
  if (q.dateFrom && q.dateTo) {
    add(`${TZ} >= ?::date`, q.dateFrom);
    add(`${TZ} <  (?::date + 1)`, q.dateTo);
  } else if (q.month) {
    add(`to_char(${TZ}, 'YYYY-MM') = ?`, q.month);
  }

  if (q.roster && q.roster.length > 0) {
    add(`lower(btrim(l.asesor)) = ANY(?)`, q.roster.map(n => n.trim().toLowerCase()));
  }

  const { rows } = await callsDb().query(
    `SELECT to_char(${TZ}, 'YYYY-MM-DD') AS fecha,
            COALESCE(l.asesor, '')            AS asesor,
            COALESCE(a.calif_global::text,'') AS calif,
            COALESCE(a.analisis, '')          AS analisis,
            COALESCE(a.transcripcion, '')     AS transcripcion,
            COALESCE(l.grabaciones[1], '')    AS record,
            0                                 AS "rowNumber",
            COALESCE(l.duracion_seg, 0)       AS duracion_segundos
       FROM ${esq}.llamadas l
       JOIN ${esq}.analisis a ON a.cuenta = l.cuenta AND a.call_id = l.call_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.fecha ASC`,
    args,
  );

  // El recorte y las frases excluidas se aplican en memoria por dos razones: son
  // la misma política que el lector de Sheets (así los dos caminos producen lo
  // mismo) y `excluded_phrases` es una lista corta que no merece un LIKE por
  // cada término.
  const max = q.maxChars ?? 80000;
  const excl = (q.excluded ?? []).map(p => p.toLowerCase()).filter(Boolean);
  return (rows as SheetCallRow[])
    .filter(r => !excl.some(p => r.transcripcion.toLowerCase().includes(p)))
    .map(r => (r.transcripcion.length > max
      ? { ...r, transcripcion: r.transcripcion.slice(0, max) }
      : r));
}

/** Nombres de asesor con al menos una llamada analizada en el periodo. */
export async function getAdvisorNamesFromDb(q: DbCallQuery): Promise<Set<string>> {
  return new Set((await getCallDataFromDb(q)).map(c => c.asesor).filter(Boolean));
}

/** Cuántas llamadas analizadas tiene cada asesor en el periodo. */
export async function getAdvisorCallCountsFromDb(q: DbCallQuery): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const c of await getCallDataFromDb(q)) {
    if (c.asesor) counts.set(c.asesor, (counts.get(c.asesor) ?? 0) + 1);
  }
  return counts;
}
