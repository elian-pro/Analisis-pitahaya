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

/**
 * Estado de la conexión, SIN la contraseña. Existe porque diagnosticar esto a
 * ciegas es carísimo: al desplegar, un fallo puede ser la variable ausente, mal
 * escrita, apuntando a otra red, o —lo más traicionero— correcta pero con el
 * proceso arrancado ANTES del cambio, porque las variables de entorno se leen
 * una sola vez. `uptimeMin` contra la hora del cambio responde eso último.
 */
export interface CallsDbInfo {
  configurada: boolean;
  host?:       string;
  puerto?:     string;
  base?:       string;
  usuario?:    string;
  ssl:         boolean;
  arrancadoEn: string;
  uptimeMin:   number;
  poolCreado:  boolean;
}

export function callsDbInfo(): CallsDbInfo {
  const conn = url();
  const base: CallsDbInfo = {
    configurada: conn.length > 0,
    ssl:         process.env.CALLS_DATABASE_SSL === 'true' || /[?&]sslmode=require/.test(conn),
    arrancadoEn: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptimeMin:   Math.round(process.uptime() / 60),
    poolCreado:  _pool !== null,
  };
  if (!conn) return base;
  // Parseo a mano y no con new URL(): la contraseña puede llevar "@" sin
  // codificar, que es justo el caso que rompe el parser estándar.
  const m = conn.match(/^\w+:\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]*)/);
  return m
    ? { ...base, usuario: m[1], host: m[3], puerto: m[4] ?? '5432', base: m[5] || '(por defecto)' }
    : { ...base, host: '(no se pudo interpretar la URL)' };
}

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
 * Traduce los fallos de conexion a algo accionable. `ENOTFOUND <host>` es el mas
 * frecuente al desplegar: en EasyPanel la red privada es POR PROYECTO, asi que
 * el host interno `<proyecto>_<servicio>` solo resuelve entre servicios del
 * mismo proyecto. Si la base vive en otro, hay que usar su conexion externa.
 */
export function explainConnError(e: unknown): string {
  const err = e as { code?: string; message?: string; hostname?: string };
  const msg = err?.message ?? String(e);
  switch (err?.code) {
    case 'ENOTFOUND':
      return `No se encuentra el host "${err.hostname ?? '?'}" de CALLS_DATABASE_URL. `
           + `En EasyPanel el host interno solo resuelve entre servicios del MISMO proyecto: `
           + `si la base está en otro, usa su conexión externa (host público y puerto).`;
    case 'ECONNREFUSED':
      return `El host de CALLS_DATABASE_URL responde pero rechaza el puerto. `
           + `Revisa el puerto y que el servicio acepte conexiones externas.`;
    case 'ETIMEDOUT':
      return `Tiempo agotado al conectar con la base de llamadas. `
           + `Suele ser un puerto cerrado por firewall.`;
    case '28P01':
      return 'Usuario o contraseña incorrectos en CALLS_DATABASE_URL. '
           + 'Si la contraseña lleva "@", codifícalo como %40.';
    case '3D000':
      return 'La base indicada en CALLS_DATABASE_URL no existe. '
           + 'Ojo: los schemas de Callpicker están en la base "postgres".';
    default:
      return msg;
  }
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
