import type { ClientConfig } from '../clients/manager';
import {
  getCallData, getAdvisorCallCounts, getAdvisorNamesWithCalls,
  getAdvisors, getAdvisorsForMonth,
  type CallRow, type SheetColumns,
} from '../google/sheets';
import { getCallDataFromDb, getAdvisorCallCountsFromDb, getAdvisorNamesFromDb } from './source';
import { normalizeAdvisorName } from '../advisors/match';

// ─────────────────────────────────────────────────────────────────────────────
// El único sitio donde se decide de dónde salen las llamadas de un cliente.
//
// Los flujos de reporte (jobs/runner, radar/dbFlow) consumen `CallRow[]` y no
// tienen por qué saber si vino de una hoja o de Postgres. Concentrar la decisión
// aquí es lo que permite migrar un cliente cambiando un campo, y lo que evita
// que dentro de un mes haya tres sitios distintos preguntando lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

export const fuenteDe = (c: ClientConfig): 'sheets' | 'postgres' =>
  c.calls_source === 'postgres' ? 'postgres' : 'sheets';

export interface ReadOpts {
  month:        string;
  dateFrom?:    string;
  dateTo?:      string;
  minDuracion?: number;
  maxChars?:    number;
  /** Nombres del roster. En Postgres filtra en SQL; en Sheets lo hace el caller. */
  roster?:      string[];
}

function requireEsquema(client: ClientConfig): string {
  if (!client.calls_schema) {
    throw new Error(
      `El cliente '${client.name}' está configurado con fuente Postgres pero no tiene schema de llamadas.`,
    );
  }
  return client.calls_schema;
}

export async function readCalls(client: ClientConfig, o: ReadOpts): Promise<CallRow[]> {
  if (fuenteDe(client) === 'postgres') {
    return getCallDataFromDb({
      esquema:     requireEsquema(client),
      roster:      o.roster,
      month:       o.month,
      dateFrom:    o.dateFrom,
      dateTo:      o.dateTo,
      // El umbral del cliente, el mismo que decide qué se transcribe. Sin esto,
      // un cliente con 90 s pagaría por transcribir llamadas de 90 a 99 s que el
      // reporte descartaría después por su cuenta (el lector default es 100).
      // El Radar pasa 0 a propósito para contar el total, y 0 no es nullish.
      minDuracion: o.minDuracion ?? client.call_min_duration_seconds,
      maxChars:    o.maxChars ?? client.transcripcion_max_chars,
      excluded:    client.excluded_phrases,
    });
  }

  const cols: SheetColumns = {
    fecha:         client.col_fecha,
    asesor:        client.col_asesor,
    calif:         client.col_calif,
    analisis:      client.col_analisis,
    transcripcion: client.col_transcripcion,
    duracion:      client.col_duracion,
    record:        client.col_record,
  };
  return getCallData(
    client.spreadsheet_id, client.data_sheet_name, cols, o.month,
    client.excluded_phrases, o.maxChars ?? client.transcripcion_max_chars,
    o.dateFrom, o.dateTo, o.minDuracion,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "¿Qué asesores tuvieron llamadas?" es la MISMA pregunta que readCalls, hecha
// dos veces más: el selector de la pestaña Reportes la usa para marcar "sin
// llamadas en este periodo", y las automatizaciones para decidir a quién
// incluir. Las dos preguntaban a la hoja directamente, así que un cliente
// migrado a Postgres salía con todo su equipo en rojo mientras el reporte, que
// sí pasa por readCalls, encontraba las llamadas sin problema.
//
// Por eso viven aquí y no en cada llamador: la fuente se decide en un sitio.
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántas llamadas tiene cada asesor en el periodo. Claves normalizadas. */
export async function readAdvisorCallCounts(
  client: ClientConfig,
  o: { month: string; dateFrom?: string; dateTo?: string },
): Promise<Map<string, number>> {
  const crudo = fuenteDe(client) === 'postgres'
    ? await getAdvisorCallCountsFromDb({
        esquema:     requireEsquema(client),
        month:       o.month,
        dateFrom:    o.dateFrom,
        dateTo:      o.dateTo,
        minDuracion: client.call_min_duration_seconds,
        excluded:    client.excluded_phrases,
      })
    : await getAdvisorCallCounts(
        client.spreadsheet_id, client.data_sheet_name, client.col_fecha, client.col_asesor,
        o.month, o.dateFrom, o.dateTo,
      );

  // Se normaliza la clave porque quien consulta compara contra el roster de la
  // base, y "Ernesto Marín " con un espacio de más no puede significar que ese
  // asesor no trabajó este mes.
  const out = new Map<string, number>();
  for (const [nombre, n] of crudo) {
    const k = normalizeAdvisorName(nombre);
    out.set(k, (out.get(k) ?? 0) + n);
  }
  return out;
}

/**
 * Los nombres del equipo TAL CUAL se escriben, para dar de alta el roster la
 * primera vez. Un cliente de Postgres no tiene hoja de asesores: sus nombres
 * están en las llamadas, así que preguntarle a Sheets devolvía un roster vacío
 * y sin forma de saber siquiera cómo se llaman.
 */
export async function readRosterNames(client: ClientConfig, month: string): Promise<string[]> {
  if (fuenteDe(client) === 'postgres') {
    return [...await getAdvisorNamesFromDb({ esquema: requireEsquema(client), month })];
  }
  const rows = client.advisors_sheet_name
    ? await getAdvisors(client.spreadsheet_id, client.advisors_sheet_name, client.col_asesor)
    : await getAdvisorsForMonth(
        client.spreadsheet_id, client.data_sheet_name, client.col_fecha, client.col_asesor, month,
      );
  return rows.map(r => r.asesor);
}

/** Los asesores con al menos una llamada en el periodo. Nombres normalizados. */
export async function readAdvisorNamesWithCalls(
  client: ClientConfig,
  o: { month: string; dateFrom?: string; dateTo?: string },
): Promise<Set<string>> {
  const crudo = fuenteDe(client) === 'postgres'
    ? await getAdvisorNamesFromDb({
        esquema:     requireEsquema(client),
        month:       o.month,
        dateFrom:    o.dateFrom,
        dateTo:      o.dateTo,
        minDuracion: client.call_min_duration_seconds,
        excluded:    client.excluded_phrases,
      })
    : await getAdvisorNamesWithCalls(
        client.spreadsheet_id, client.data_sheet_name, client.col_fecha, client.col_asesor,
        o.month, o.dateFrom, o.dateTo,
      );
  return new Set([...crudo].map(normalizeAdvisorName));
}

export type { CallRow };
