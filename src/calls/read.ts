import type { ClientConfig } from '../clients/manager';
import { getCallData, type CallRow, type SheetColumns } from '../google/sheets';
import { getCallDataFromDb } from './source';

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

export async function readCalls(client: ClientConfig, o: ReadOpts): Promise<CallRow[]> {
  if (fuenteDe(client) === 'postgres') {
    if (!client.calls_schema) {
      throw new Error(
        `El cliente '${client.name}' está configurado con fuente Postgres pero no tiene schema de llamadas.`,
      );
    }
    return getCallDataFromDb({
      esquema:     client.calls_schema,
      roster:      o.roster,
      month:       o.month,
      dateFrom:    o.dateFrom,
      dateTo:      o.dateTo,
      minDuracion: o.minDuracion,
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

export type { CallRow };
