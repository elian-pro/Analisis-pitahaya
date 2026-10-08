import { Pool } from 'pg';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { dbEnabled, dbGet, dbUpsert, dbDelete, TENANT_DB_TABLE } from '../config/db';
import { encryptSecret, decryptSecret } from '../config/secrets';
import { loadClients, getClient, type ClientConfig } from '../clients/manager';
import type { Cuenta } from './registry';
import { quoteIdent } from './db';
import { callsDb } from './db';
import type { CallsConfig } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// La base Postgres de un cliente externo (calls_source: 'cliente_pg').
//
// Zebra crea esa base desde cero, así que el esquema es el ESTÁNDAR del
// pipeline (`llamadas` + `analisis`): ninguna consulta cambia, solo el pool al
// que se le habla. `poolDe(cuenta)` es ese único punto de decisión.
//
// La contraseña vive cifrada (config/secrets.ts) en la tabla tenant_db de la
// base principal, NUNCA dentro de ClientConfig: /api/clients devuelve ese jsonb
// crudo y un secreto ahí dentro se filtraría solo.
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantDbConfig {
  host:         string;
  port:         number;
  database:     string;
  user:         string;
  /** Cifrada con TENANT_DB_SECRET (v1.iv.tag.ct). */
  password_enc: string;
  ssl:          boolean;
  /** Schema donde viven llamadas/analisis. La app lo crea. */
  schema:       string;
  /** Solo se analizan llamadas desde esta fecha (como zebra_calls_config.desde). */
  desde?:       string | null;
  probado_en?:  string | null;
}

export const TENANT_SCHEMA_DEFAULT = 'zebra';

// ── Configuración por cliente ────────────────────────────────────────────────

export async function getTenantDbConfig(clientId: string): Promise<TenantDbConfig | undefined> {
  if (!dbEnabled) return undefined;
  return dbGet<TenantDbConfig>(TENANT_DB_TABLE, clientId);
}

export async function saveTenantDbConfig(clientId: string, cfg: TenantDbConfig): Promise<void> {
  await dbUpsert(TENANT_DB_TABLE, clientId, cfg);
  evictPool(clientId);
}

export async function deleteTenantDbConfig(clientId: string): Promise<void> {
  await dbDelete(TENANT_DB_TABLE, clientId);
  evictPool(clientId);
}

/** Cifra la contraseña para guardarla. Aparte para que el router no toque secrets. */
export const sealPassword = (plain: string): string => encryptSecret(plain);

// ── Anti-SSRF ────────────────────────────────────────────────────────────────
// El cliente escribe host y puerto: sin este filtro, "su base" puede ser
// 127.0.0.1 o un servicio interno de EasyPanel, y la feature se convierte en un
// proxy hacia la red privada de Zebra. Se valida la IP RESUELTA, no el nombre.

export function addressAllowed(ip: string): boolean {
  let addr = ip.toLowerCase();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7); // IPv4 mapeada
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;            // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
  }
  if (net.isIPv6(addr)) {
    if (addr === '::1' || addr === '::') return false;
    if (addr.startsWith('fe80')) return false;           // link-local
    if (addr.startsWith('fc') || addr.startsWith('fd')) return false; // ULA
    return true;
  }
  return false;
}

export async function assertHostAllowed(host: string): Promise<void> {
  const target = host.trim();
  const ips = net.isIP(target)
    ? [target]
    : (await dns.lookup(target, { all: true })).map(r => r.address);
  if (ips.length === 0) throw new Error(`No se pudo resolver el host '${host}'.`);
  for (const ip of ips) {
    if (!addressAllowed(ip)) {
      throw new Error(`El host '${host}' resuelve a una dirección interna (${ip}) y no está permitido.`);
    }
  }
}

// ── Pool por tenant ──────────────────────────────────────────────────────────

const IDLE_EVICT_MS = 30 * 60 * 1000;
const pools = new Map<string, { pool: Pool; hash: string; ultimoUso: number }>();

const cfgHash = (c: TenantDbConfig) =>
  crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');

function evictPool(clientId: string): void {
  const e = pools.get(clientId);
  if (e) { void e.pool.end().catch(() => {}); pools.delete(clientId); }
}

/** Pool hacia la base del cliente. Crea, cachea y recicla si cambió la config. */
export async function tenantPool(clientId: string, cfg?: TenantDbConfig): Promise<Pool> {
  const config = cfg ?? await getTenantDbConfig(clientId);
  if (!config) throw new Error(`El cliente '${clientId}' no tiene base de datos configurada.`);
  const hash = cfgHash(config);
  const hit = pools.get(clientId);
  if (hit && hit.hash === hash) { hit.ultimoUso = Date.now(); return hit.pool; }
  if (hit) evictPool(clientId);

  await assertHostAllowed(config.host);
  // Objeto de config y no URL: una contraseña con '@' o '/' rompe el parseo de
  // URL (la lección ya documentada en calls/db.ts).
  const pool = new Pool({
    host:     config.host,
    port:     config.port,
    database: config.database,
    user:     config.user,
    password: decryptSecret(config.password_enc),
    ssl:      config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 20_000,
    application_name: 'zebra-reports',
  });
  // Una base ajena que se cae no puede tumbar el proceso (igual que los otros pools).
  pool.on('error', (err) => console.error(`[calls/tenant] ${clientId}: idle client error:`, err.message));
  pools.set(clientId, { pool, hash, ultimoUso: Date.now() });
  return pool;
}

// Poda de pools sin uso: una base de un cliente que no genera reportes no
// merece conexiones abiertas media noche.
setInterval(() => {
  const t = Date.now();
  for (const [id, e] of pools) if (t - e.ultimoUso > IDLE_EVICT_MS) evictPool(id);
}, IDLE_EVICT_MS).unref();

// ── Diagnóstico por pasos ────────────────────────────────────────────────────
// Quien conecta una base no tiene por qué preguntarle a nadie qué falla: cada
// paso dice si pasó y, si no, qué hay que cambiar. Se para en el primero que
// falla, porque los siguientes dependen de él.

export type PasoId = 'host' | 'puerto' | 'ssl' | 'credenciales' | 'permisos' | 'estructura';

export interface Paso {
  id:       PasoId;
  /** true pasó · false falló · null no se comprobó o es solo informativo. */
  ok:       boolean | null;
  detalle:  string;
  arreglo?: string;
  /** Para que la pantalla ofrezca la acción concreta (p. ej. "Conectar sin SSL"). */
  codigo?:  'ssl_no_soportado';
}

export const PASOS: PasoId[] = ['host', 'puerto', 'ssl', 'credenciales', 'permisos', 'estructura'];

interface Contexto { host: string; port: number; database?: string; ip?: string | null }

/**
 * A qué paso pertenece un fallo y qué hacer con él. Pura, para poder probarla
 * sin red. `enCurso` es el paso que se estaba comprobando: lo que no se
 * reconoce se le atribuye a él.
 *
 * Con un host que resuelve a varias IPs (IPv4 + IPv6) y todas fallan, Node
 * lanza un AggregateError con el mensaje VACÍO: el código vive en `.errors`.
 */
export function clasificarFallo(e: unknown, ctx: Contexto, enCurso: PasoId): Omit<Paso, 'ok'> {
  const err = e as Error & { code?: string; errors?: Array<Error & { code?: string }> };
  const code = err.code ?? err.errors?.[0]?.code;
  const raw = err.message || err.errors?.map(x => x.message).join('; ') || code || String(e);
  const donde = `${ctx.host}:${ctx.port}`;
  const desde = ctx.ip ? `la IP ${ctx.ip}` : 'la IP del servidor de Zebra Reports';

  if (/dirección interna/.test(raw)) {
    return { id: 'host', detalle: raw, arreglo: 'Usa la dirección pública de la base, no una de red interna.' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { id: 'host', detalle: `No existe el host ${ctx.host}.`, arreglo: 'Revisa que esté bien escrito.' };
  }
  if (code === 'ECONNREFUSED') {
    return { id: 'puerto', detalle: `La base rechazó la conexión en ${donde}.`,
      arreglo: `Revisa el puerto y que Postgres acepte conexiones de fuera (listen_addresses = '*').` };
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH'
      || /connection timeout|no respondió/i.test(raw)) {
    return { id: 'puerto', detalle: `${donde} no respondió.`,
      arreglo: `Abre el puerto ${ctx.port} en el firewall de la base para ${desde}, o revisa que sea el puerto correcto.` };
  }
  if (/does not support SSL/i.test(raw)) {
    return { id: 'ssl', codigo: 'ssl_no_soportado', detalle: 'La base no acepta conexiones cifradas (SSL).',
      arreglo: 'Conéctate sin SSL o pide que lo activen en su Postgres.' };
  }
  if (code === '28P01') {
    return { id: 'credenciales', detalle: 'Usuario o contraseña incorrectos.',
      arreglo: 'Revisa los dos: la contraseña distingue mayúsculas.' };
  }
  if (code === '3D000') {
    return { id: 'credenciales', detalle: `No existe la base "${ctx.database ?? ''}".`,
      arreglo: 'Revisa el nombre exacto de la base (distingue mayúsculas).' };
  }
  if (code === '28000') {
    return { id: 'credenciales', detalle: raw,
      arreglo: `Añade en pg_hba.conf una regla que deje entrar a este usuario desde ${desde}.` };
  }
  return { id: enCurso, detalle: raw };
}

/** El fallo en una frase, para las rutas que no pintan pasos (/provision). */
export function errorDeConexion(e: unknown, host: string, port: number): string {
  const f = clasificarFallo(e, { host, port }, 'credenciales');
  return [f.detalle, f.arreglo].filter(Boolean).join(' ');
}

// La IP con la que este servidor sale a internet: es la que el cliente tiene que
// dejar entrar. Se pregunta una vez; si el servicio no contesta, los textos
// hablan de "la IP del servidor" sin número y se reintenta la próxima vez.
let _ipSalida: string | undefined;
export async function ipSalida(): Promise<string | null> {
  if (_ipSalida) return _ipSalida;
  try {
    const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) });
    const ip = (await r.text()).trim();
    if (r.ok && net.isIP(ip)) _ipSalida = ip;
  } catch { /* sin IP los textos siguen sirviendo */ }
  return _ipSalida ?? null;
}

/** TCP pelado, antes de hablar Postgres: separa "no llego" de "no me deja entrar". */
function abrirPuerto(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(5000, () => { sock.destroy(); reject(Object.assign(new Error('no respondió'), { code: 'ETIMEDOUT' })); });
    sock.once('connect', () => { sock.destroy(); resolve(); });
    sock.once('error', reject);
  });
}

/**
 * Prueba una conexión paso a paso SIN pasar por el caché de pools: sirve para
 * credenciales aún no guardadas y para no dejar cacheada una config fallida.
 */
export async function probeTenantDb(cfg: TenantDbConfig): Promise<{ ok: boolean; pasos: Paso[]; ms: number }> {
  const t0 = Date.now();
  const ctx: Contexto = { host: cfg.host, port: cfg.port, database: cfg.database, ip: await ipSalida() };
  const pasos: Paso[] = [];
  const hecho = (id: PasoId, ok: boolean | null, detalle: string) => pasos.push({ id, ok, detalle });
  const fin = () => {
    for (const id of PASOS) if (!pasos.some(p => p.id === id)) pasos.push({ id, ok: null, detalle: 'Sin comprobar' });
    return { ok: !pasos.some(p => p.ok === false), pasos, ms: Date.now() - t0 };
  };
  let enCurso: PasoId = 'host';
  const falla = (e: unknown) => {
    const c = clasificarFallo(e, ctx, enCurso);
    // Un paso ya superado no se repite: si el fallo apunta a él (el puerto dejó
    // de responder entre la sonda TCP y pg), cuenta para el que estaba en curso.
    const f = pasos.some(p => p.id === c.id) ? { ...c, id: enCurso } : c;
    for (const id of PASOS.slice(0, PASOS.indexOf(f.id))) {
      if (!pasos.some(p => p.id === id)) pasos.push({ id, ok: null, detalle: 'Sin comprobar' });
    }
    pasos.push({ ...f, ok: false });
    return fin();
  };

  try { await assertHostAllowed(cfg.host); } catch (e) { return falla(e); }
  hecho('host', true, `${cfg.host} resuelve a una dirección pública`);

  enCurso = 'puerto';
  try { await abrirPuerto(cfg.host, cfg.port); } catch (e) { return falla(e); }
  hecho('puerto', true, `El puerto ${cfg.port} responde`);

  enCurso = cfg.ssl ? 'ssl' : 'credenciales';
  if (!cfg.ssl) hecho('ssl', null, 'Desactivado: los datos viajan sin cifrar');

  let password: string;
  try { password = decryptSecret(cfg.password_enc); } catch {
    enCurso = 'credenciales';
    return falla(new Error('No se pudo leer la contraseña guardada (cambió la clave del servidor). Vuelve a escribirla.'));
  }
  const pool = new Pool({
    host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10_000,
  });
  pool.on('error', () => {});
  try {
    const client = await pool.connect();
    try {
      if (cfg.ssl) hecho('ssl', true, 'Conexión cifrada');
      hecho('credenciales', true, `Entra como ${cfg.user} en ${cfg.database}`);

      enCurso = 'permisos';
      const { rows: [r] } = await client.query(
        `SELECT n.oid IS NOT NULL                                   AS esq_existe,
                has_database_privilege(current_database(), 'CREATE') AS crea_en_base,
                CASE WHEN n.oid IS NULL THEN NULL
                     ELSE has_schema_privilege(n.oid, 'CREATE') END   AS crea_en_esq,
                (SELECT count(*)::int FROM information_schema.tables
                  WHERE table_schema = $1 AND table_name IN ('llamadas','analisis')) AS tablas
           FROM (SELECT 1) uno LEFT JOIN pg_namespace n ON n.nspname = $1`, [cfg.schema]);
      const listo = r.tablas === 2;
      // Con la estructura ya creada basta poder escribir el análisis; sin ella,
      // hay que poder crearla (en el esquema si existe, en la base si no).
      const puede = listo
        ? (await client.query(
            `SELECT has_table_privilege($1, 'INSERT, UPDATE') AS ok`,
            [`${quoteIdent(cfg.schema)}.analisis`])).rows[0].ok
        : r.esq_existe ? r.crea_en_esq : r.crea_en_base;
      if (!puede) {
        pasos.push({ id: 'permisos', ok: false,
          detalle: listo ? `${cfg.user} no puede escribir en ${cfg.schema}.analisis.`
                         : `${cfg.user} no puede crear tablas${r.esq_existe ? ` en el esquema ${cfg.schema}` : ' en la base'}.`,
          arreglo: listo ? `Dale INSERT y UPDATE sobre ${cfg.schema}.analisis.`
                         : r.esq_existe ? `Dale CREATE sobre el esquema ${cfg.schema}.`
                                        : `Dale CREATE sobre la base ${cfg.database}, o crea antes el esquema ${cfg.schema} y dale CREATE sobre él.` });
        return fin();
      }
      hecho('permisos', true, listo ? 'Puede escribir el análisis' : 'Puede crear las tablas del pipeline');
      hecho('estructura', listo ? true : null,
        listo ? `Tablas de ${cfg.schema} listas` : `Las tablas se crean al pulsar "Guardar y preparar"`);
      return fin();
    } finally { client.release(); }
  } catch (e) {
    return falla(e);
  } finally {
    void pool.end().catch(() => {});
  }
}

/** El pool que corresponde a una cuenta: el del tenant o el de Callpicker. */
export async function poolDe(cuenta: Cuenta): Promise<Pool> {
  return cuenta.tenant ? tenantPool(cuenta.slug) : callsDb();
}

// ── Cuentas sintéticas para el sweeper/pipeline ──────────────────────────────
// Un cliente externo no existe en callpicker_registro: su "cuenta" se sintetiza
// desde ClientConfig + tenant_db, con slug = client_id.

export function cuentaDeTenant(client: ClientConfig, cfg: TenantDbConfig): Cuenta {
  return {
    slug: client.id, cliente: client.name, esquema: cfg.schema || TENANT_SCHEMA_DEFAULT,
    activa: true, habilitada: true, tenant: true,
  };
}

export async function cuentasTenant(): Promise<Cuenta[]> {
  if (!dbEnabled) return [];
  const out: Cuenta[] = [];
  for (const c of await loadClients()) {
    if (c.calls_source !== 'cliente_pg') continue;
    const cfg = await getTenantDbConfig(c.id);
    if (cfg) out.push(cuentaDeTenant(c, cfg));
  }
  return out;
}

/** Si ese id es de un cliente externo, TENGA O NO su base conectada ya. */
export async function esClienteExterno(slug: string): Promise<boolean> {
  if (!dbEnabled) return false;
  return (await getClient(slug))?.calls_source === 'cliente_pg';
}

export async function tenantCuenta(slug: string): Promise<Cuenta | undefined> {
  if (!dbEnabled) return undefined;
  const client = await getClient(slug);
  if (!client || client.calls_source !== 'cliente_pg') return undefined;
  const cfg = await getTenantDbConfig(slug);
  return cfg ? cuentaDeTenant(client, cfg) : undefined;
}

/** El equivalente de zebra_calls_config para un tenant: siempre encendido. */
export async function configDeTenant(cuenta: Cuenta): Promise<CallsConfig | undefined> {
  const [client, cfg] = [await getClient(cuenta.slug), await getTenantDbConfig(cuenta.slug)];
  if (!cfg) return undefined;
  return {
    esquema: cuenta.esquema,
    desde: cfg.desde ?? null,
    contexto_negocio: client?.contexto_negocio ?? null,
    auto: true,
  } as CallsConfig;
}

// ── Provisionamiento ─────────────────────────────────────────────────────────
// La base la crea Zebra desde cero: estas dos tablas SON el contrato. Idempotente.

export async function ensureTenantSchema(pool: Pool, schema: string): Promise<void> {
  const esq = quoteIdent(schema);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${esq}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${esq}.llamadas (
      cuenta             TEXT NOT NULL,
      call_id            TEXT NOT NULL,
      fecha              TIMESTAMPTZ NOT NULL,
      asesor             TEXT,
      contraparte_numero TEXT,
      ciudad             TEXT,
      duracion_seg       INTEGER NOT NULL DEFAULT 0,
      estatus            TEXT,
      n_grabaciones      INTEGER NOT NULL DEFAULT 0,
      grabaciones        TEXT[] NOT NULL DEFAULT '{}',
      creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (cuenta, call_id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS llamadas_fecha_idx ON ${esq}.llamadas (fecha)`);
  // Misma tabla y misma fórmula que ensureAnalisisTable (calls/config.ts): el
  // pipeline no distingue de quién es la base.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${esq}.analisis (
      cuenta        TEXT NOT NULL,
      call_id       TEXT NOT NULL,
      estado        TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','descartada','transcrita','analizada','fallida')),
      transcripcion TEXT,
      tipo_contacto TEXT,
      presentacion  TEXT,
      precalif      TEXT,
      exploracion   TEXT,
      agenda        TEXT,
      analisis      TEXT,
      calif_global  INTEGER GENERATED ALWAYS AS (
        CASE WHEN analisis = 'Buzón de voz' THEN NULL
        ELSE (CASE WHEN presentacion ~* '^s[ií]' THEN 10 ELSE 0 END)
           + (CASE WHEN precalif     ~* '^s[ií]' THEN 25 ELSE 0 END)
           + (CASE WHEN exploracion  ~* '^s[ií]' THEN 30 ELSE 0 END)
           + (CASE WHEN agenda       ~* '^s[ií]' THEN 35 ELSE 0 END)
        END) STORED,
      error         TEXT,
      intentos      INTEGER NOT NULL DEFAULT 0,
      procesado_at  TIMESTAMPTZ,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (cuenta, call_id)
    )`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS analisis_pendientes_idx ON ${esq}.analisis (estado, intentos)
     WHERE estado IN ('pendiente','transcrita','fallida')`);
  await ensureReportTables(pool, schema);
}

/**
 * Las tablas de los documentos entregados: el PDF de cada reporte y el sidecar
 * del comparativo de Radar. Van en la base del CLIENTE y no en la de Zebra, que
 * es donde estuvieron un dia: su transcripcion y el analisis de cada llamada ya
 * viven aqui (tabla `analisis`), y el PDF no es mas que un render de eso mismo.
 * Guardarlo en nuestra base era la unica pieza que se salia del patron.
 *
 * Aparte de ensureTenantSchema porque tambien se llama en perezoso antes de
 * escribir: un cliente aprovisionado antes de que estas tablas existieran no
 * vuelve a pulsar "Guardar y preparar", y CREATE TABLE IF NOT EXISTS no altera
 * lo ya creado. Son dos consultas idempotentes delante de una operacion que
 * tarda un minuto en un LLM: no merece cachear el estado.
 */
export async function ensureReportTables(pool: Pool, schema: string): Promise<void> {
  const esq = quoteIdent(schema);
  // Sin columna client_id: la BASE es el cliente. Eso convierte el aislamiento
  // en estructural — no hay un WHERE que se pueda olvidar. Quien lea el SELECT
  // sin filtro la va a echar de menos, y esta es la razon.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${esq}.reportes (
      id          TEXT        PRIMARY KEY,
      kind        TEXT        NOT NULL,
      period_key  TEXT        NOT NULL,
      filename    TEXT        NOT NULL,
      size_bytes  INTEGER     NOT NULL,
      pdf         BYTEA       NOT NULL,
      creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS reportes_creado_idx ON ${esq}.reportes (creado_en DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${esq}.radar_sidecars (
      period_key TEXT        PRIMARY KEY,
      sidecar    TEXT        NOT NULL,
      creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

/** Pool y esquema de un cliente externo, listos para consultar. */
export async function tenantTarget(clientId: string): Promise<{ pool: Pool; esquema: string }> {
  const cfg = await getTenantDbConfig(clientId);
  if (!cfg) throw new Error(`El cliente '${clientId}' no tiene su base de datos configurada todavía.`);
  return { pool: await tenantPool(clientId, cfg), esquema: cfg.schema || TENANT_SCHEMA_DEFAULT };
}
