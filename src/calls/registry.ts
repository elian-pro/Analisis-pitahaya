import { callsDb, callsDbEnabled, quoteIdent } from './db';
import { tenantCuenta, esClienteExterno } from './tenant';
import { puedeCaerAlRegistro } from './aislamiento';
import { listConfigs, debeBarrer } from './config';

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
  /** true si la cuenta es la base propia de un cliente externo (calls/tenant.ts). */
  tenant?:    boolean;
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
  // Un cliente externo no vive en callpicker_registro: su cuenta se sintetiza
  // desde su configuración (y no requiere la base de Callpicker).
  //
  // Y si todavía no la conectó, la respuesta es "no hay cuenta". NO se sigue
  // buscando en el registro: un slug coincidente le entregaría las llamadas de
  // otro cliente, que es exactamente el fallo que esto cierra.
  if (await esClienteExterno(slug)) return tenantCuenta(slug);
  if (!puedeCaerAlRegistro(false)) return undefined;
  if (!callsDbEnabled()) return undefined;
  return (await listCuentas()).find(c => c.slug === slug);
}

/**
 * Deja por escrito en el log quién entra y quién no, y por qué.
 *
 * Importa más desde que el barrido dejó de depender de una variable de entorno:
 * antes bastaba mirar `CALLS_PIPELINE` para saber si algo iba a pasar, y aun así
 * estuvo un día entero apagada sin que nadie lo notara. Ahora esto es lo primero
 * que sale en cada arranque, con el estado de cada origen y cuántas llamadas
 * espera cada uno.
 */
export async function logCuentas(): Promise<void> {
  const todas   = await listCuentas();
  const configs = new Map((await listConfigs()).map(c => [c.esquema, c]));

  const lineas = await Promise.all(todas.map(async (c) => {
    if (!c.activa)     return `${c.slug}: fuera · inactiva en el registro de Callpicker`;
    if (!c.habilitada) return `${c.slug}: fuera · sin tabla analisis`;
    const cfg = configs.get(c.esquema);
    if (!debeBarrer(cfg)) {
      return `${c.slug}: EN PAUSA · ${cfg ? 'apagado en Ajustes' : 'sin configurar'}`;
    }
    // Cuántas va a procesar: el número que convierte "está encendido" en algo
    // que se puede comprobar de un vistazo.
    let pend = '?';
    try {
      const { rows: [r] } = await callsDb().query(
        `SELECT count(*)::int n FROM ${quoteIdent(c.esquema)}.llamadas l
           LEFT JOIN ${quoteIdent(c.esquema)}.analisis a
             ON a.cuenta = l.cuenta AND a.call_id = l.call_id
          WHERE l.n_grabaciones > 0 AND l.duracion_seg >= 100 AND a.estado IS NULL
            AND ($1::date IS NULL OR (l.fecha AT TIME ZONE 'America/Mexico_City') >= $1::date)`,
        [cfg?.desde ?? null]);
      pend = String(r.n);
    } catch { /* el conteo es informativo: no puede tumbar el arranque */ }
    return `${c.slug}: encendido · ${pend} por procesar · desde ${cfg?.desde ?? 'siempre'}`;
  }));

  for (const l of lineas) console.log(`[calls] ${l}`);
}

/** Nombre citado del schema, listo para interpolar en una consulta. */
export const esquemaDe = (c: Cuenta): string => quoteIdent(c.esquema);
