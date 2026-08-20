import { Pool } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Conexión a la base de LLAMADAS, que es un servicio Postgres distinto del de
// Zebra Reports (clientes, automatizaciones, jobs). Por eso hace falta un
// segundo pool y no se puede reutilizar config/db.ts.
//
// Consecuencia que condiciona todo el pipeline: no hay JOIN posible entre las
// dos bases. El roster de asesores y los prompts viven en una y las llamadas en
// la otra, así que todo cruce entre ambas se resuelve en memoria.
//
// Dentro de esta base sí se puede unir: `llamadas` y `analisis` conviven en el
// mismo schema por cliente, y de ahí sale la consulta de pendientes.
// ─────────────────────────────────────────────────────────────────────────────

// El pool se crea la primera vez que se usa, no al importar el módulo: leer
// process.env en el nivel superior obliga a que config/env (que es quien llama a
// dotenv) se importe antes, y eso convierte el orden de los imports en un
// requisito invisible que se rompe en el primer script que los ponga al revés.
let _pool: Pool | null = null;

const url = (): string => process.env.CALLS_DATABASE_URL ?? '';

export const callsDbEnabled = (): boolean => url().length > 0;

export function callsDb(): Pool {
  if (_pool) return _pool;

  const conn = url();
  if (!conn) {
    throw new Error(
      'El pipeline de llamadas necesita CALLS_DATABASE_URL (la base donde Callpicker escribe).',
    );
  }
  const useSsl =
    process.env.CALLS_DATABASE_SSL === 'true' || /[?&]sslmode=require/.test(conn);

  _pool = new Pool({
    connectionString: conn,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // Más bajo que el pool principal: el pipeline procesa en serie y solo
    // necesita una conexión a la vez; el resto son consultas de la pestaña.
    max: 3,
  });
  // Un error del pool (una conexión inactiva que se cae) no puede tumbar el
  // proceso: pg lo emite en el pool y un 'error' sin manejar sería fatal.
  _pool.on('error', (err) => console.error('[calls/db] idle client error:', err.message));
  return _pool;
}

/**
 * Los identificadores de schema vienen de `callpicker_registro.cuentas`, que es
 * una tabla que administramos nosotros, pero se citan igual antes de
 * interpolarlos: son nombres con mayúsculas y espacios ("Grupo Gira"), así que
 * sin comillas ni siquiera funcionarían, y con ellas tampoco se puede inyectar.
 */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}
