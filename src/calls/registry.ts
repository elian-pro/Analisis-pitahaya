import { callsDb, quoteIdent } from './db';

// ─────────────────────────────────────────────────────────────────────────────
// Qué cuentas de Callpicker procesa el pipeline.
//
// La fuente es `callpicker_registro.cuentas`, que ya mapea cliente → schema y
// existía antes que este pipeline. No hay que mantener una lista paralela.
//
// El interruptor de "está habilitado" es la EXISTENCIA de la tabla `analisis`
// en su schema. No hay flag ni variable de entorno: crear la tabla habilita al
// cliente y borrarla lo apaga. Una lista en el código o en la config podría
// desincronizarse de la realidad; esto no puede, porque la condición es la
// realidad misma — si no hay tabla, no hay dónde escribir.
// ─────────────────────────────────────────────────────────────────────────────

export interface Cuenta {
  /** Identificador corto: 'midstorage', 'sofia'. */
  slug:      string;
  /** Nombre comercial tal como está en el registro. */
  cliente:   string;
  /** Schema donde viven `llamadas` y `analisis`. */
  esquema:   string;
  activa:    boolean;
  /** true si su schema ya tiene tabla `analisis`. */
  habilitada: boolean;
}

export async function listCuentas(): Promise<Cuenta[]> {
  const { rows } = await callsDb().query(`
    SELECT c.slug, c.cliente, c.esquema, c.activa,
           EXISTS (
             SELECT 1 FROM information_schema.tables t
              WHERE t.table_schema = c.esquema AND t.table_name = 'analisis'
           ) AS habilitada
      FROM callpicker_registro.cuentas c
     ORDER BY c.slug`);
  return rows as Cuenta[];
}

/** Las que el pipeline debe procesar: activas y con tabla donde escribir. */
export async function listCuentasHabilitadas(): Promise<Cuenta[]> {
  return (await listCuentas()).filter(c => c.activa && c.habilitada);
}

export async function getCuenta(slug: string): Promise<Cuenta | undefined> {
  return (await listCuentas()).find(c => c.slug === slug);
}

/**
 * Deja por escrito en el log quién entra y quién no. Sin esto, "Sofía no se
 * procesa" parece un fallo en vez de una decisión.
 */
export async function logCuentas(): Promise<void> {
  const todas = await listCuentas();
  const on  = todas.filter(c => c.activa && c.habilitada).map(c => c.slug);
  const off = todas.filter(c => !(c.activa && c.habilitada))
                   .map(c => `${c.slug} (${!c.activa ? 'inactiva' : 'sin tabla analisis'})`);
  console.log(`[calls] procesando: ${on.join(', ') || 'ninguna'}`);
  if (off.length) console.log(`[calls] fuera: ${off.join(', ')}`);
}

/** Nombre citado del schema, listo para interpolar en una consulta. */
export const esquemaDe = (c: Cuenta): string => quoteIdent(c.esquema);
