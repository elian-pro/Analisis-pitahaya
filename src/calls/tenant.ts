import { Pool } from 'pg';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { dbEnabled, dbGet, dbUpsert, dbDelete, TENANT_DB_TABLE } from '../config/db';
import { encryptSecret, decryptSecret } from '../config/secrets';
import { loadClients, getClient, type ClientConfig } from '../clients/manager';
import type { Cuenta } from './registry';
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
  const esq = '"' + schema.replace(/"/g, '""') + '"';
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
}
