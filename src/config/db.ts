import { Pool } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL connection (EasyPanel-hosted Postgres or any Postgres URL).
//
// Persistence model:
//   • If DATABASE_URL is set  → clients & schedules live in Postgres and survive
//     redeploys (the data is in the database, not in the container's filesystem).
//   • If DATABASE_URL is NOT set → the app falls back to the legacy JSON files,
//     so local development keeps working without a database.
//
// In EasyPanel, create a Postgres service in the SAME project, then set
// DATABASE_URL on this service to the INTERNAL connection string, e.g.
//   postgres://postgres:PASSWORD@<project>_<service>:5432/postgres
// The internal hostname is reachable inside the project's private network and
// needs no SSL. For an EXTERNAL connection, also set DATABASE_SSL=true.
// ─────────────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? '';

export const dbEnabled = DATABASE_URL.length > 0;

// Only enable SSL when explicitly requested (external connections). Internal
// EasyPanel service-to-service traffic stays on the private network without SSL.
const useSsl =
  process.env.DATABASE_SSL === 'true' || /[?&]sslmode=require/.test(DATABASE_URL);

export const pool: Pool | null = dbEnabled
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    })
  : null;

if (pool) {
  // A pool-level error (e.g. a dropped idle connection) must not crash the
  // process — pg emits it on the pool, and an unhandled 'error' would be fatal.
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
}

// Table names — single source of truth. Each row stores the full domain object
// in a `data` jsonb column, keyed by its `id`, so the existing TypeScript shapes
// are preserved exactly with no per-field schema to keep in sync.
export const CLIENTS_TABLE = 'clients';
export const SCHEDULES_TABLE = 'schedules';
export const JOBS_TABLE = 'jobs';
export const TOKEN_LOG_TABLE = 'token_log';
export const REPORT_METRICS_TABLE = 'report_metrics';
export const ADVISORS_TABLE = 'advisors';
export const CALLS_TABLE = 'calls';

/**
 * Creates the tables if they don't exist. Safe to run on every boot.
 */
// ponytail: CREATE TABLE IF NOT EXISTS no altera tablas ya creadas. Si cambian
// los pesos de calif_global (10/25/30/35), hay que hacer el ALTER a mano; pasar
// a migraciones versionadas solo cuando eso ocurra más de una vez.
export async function ensureSchema(): Promise<void> {
  if (!pool) return;
  // Config + job tables: full object stored per row in a jsonb column.
  for (const table of [CLIENTS_TABLE, SCHEDULES_TABLE, JOBS_TABLE, ADVISORS_TABLE]) {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
         id         TEXT PRIMARY KEY,
         data       JSONB       NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  }
  // Token usage log: analytical data, so real columns (queried/aggregated by date).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TOKEN_LOG_TABLE} (
       id         BIGSERIAL   PRIMARY KEY,
       ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
       job_id     TEXT,
       client_id  TEXT,
       input      INTEGER     NOT NULL,
       output     INTEGER     NOT NULL,
       advisors   INTEGER     NOT NULL
     )`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS token_log_ts_idx ON ${TOKEN_LOG_TABLE} (ts)`,
  );
  // Per-advisor report metrics per period: powers "compare vs previous period"
  // from the database (with Drive sidecars kept as a redundant fallback).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${REPORT_METRICS_TABLE} (
       client_id     TEXT        NOT NULL,
       advisor       TEXT        NOT NULL,
       period_key    TEXT        NOT NULL,
       period_start  DATE        NOT NULL,
       avg_score     INTEGER,
       pct_siguiente INTEGER,
       talk_ratio    INTEGER,
       sidecar_text  TEXT,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       PRIMARY KEY (client_id, advisor, period_key)
     )`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS report_metrics_lookup_idx
       ON ${REPORT_METRICS_TABLE} (client_id, advisor, period_start)`,
  );
  // Dashboard aggregation (queryReportMetrics in metrics/store.ts) filters by
  // client_id + a period_start range, usually WITHOUT an advisor (team view).
  // The lookup index above leads with advisor, so it can't range-scan
  // period_start without one; this index serves that access pattern directly.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS report_metrics_client_period_idx
       ON ${REPORT_METRICS_TABLE} (client_id, period_start)`,
  );
  // Llamadas: reemplaza la hoja "Analisis" de Google Sheets como fuente de
  // verdad. La fila cruda del webhook de Callpicker se inserta primero y se
  // completa después con transcripción y análisis, de modo que una llamada
  // sobrevive aunque Gemini o el modelo fallen (en Sheets se perdía: no se
  // escribía nada hasta terminar todo el pipeline).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${CALLS_TABLE} (
       call_id       TEXT        PRIMARY KEY,
       -- Nullable a propósito: dos clientes pueden compartir la misma fuente de
       -- llamadas y solo el roster de asesores los separa (ver advisors/match.ts),
       -- así que a veces no se puede decidir de quién es una llamada al recibirla.
       -- Se guarda igual, con estado 'sin_asignar', en vez de rechazarla.
       client_id     TEXT,
       fecha         TIMESTAMPTZ NOT NULL,
       asesor        TEXT        NOT NULL,
       callee_number TEXT,
       callee_city   TEXT,
       callee_state  TEXT,
       call_status   TEXT,
       wait_time     INTEGER,
       duracion_segundos INTEGER NOT NULL DEFAULT 0,
       record        TEXT,
       raw           JSONB,
       procesado_at  TIMESTAMPTZ,
       lead_id       TEXT,
       tipo_contacto TEXT,
       presentacion  TEXT,
       precalif      TEXT,
       exploracion   TEXT,
       agenda        TEXT,
       analisis      TEXT,
       transcripcion TEXT,
       -- Estado del pipeline. 'descartada' (corta o sin grabación) NO es un fallo
       -- y se distingue de 'fallida' para que el monitoreo no las mezcle; sin esta
       -- columna, "pendiente" y "rota" eran indistinguibles.
       estado        TEXT        NOT NULL DEFAULT 'recibida'
                     CHECK (estado IN ('recibida','descartada','transcrita',
                                       'analizada','fallida','sin_asignar')),
       error         TEXT,
       -- Frena el reintento eterno de un fallo permanente (audio borrado, cuota).
       intentos      INTEGER     NOT NULL DEFAULT 0,
       -- Reemplaza la fórmula ArrayFormula de la columna "Calif global".
       -- La original usaba HALLAR("S", ...), que busca la letra suelta sin
       -- distinguir mayúsculas: "Whatsapp" contenía una "s" y cobraba los 35
       -- puntos de agendamiento pese a significar que el asesor NUNCA intentó
       -- agendar. El patrón ^s[ií] exige que el valor empiece por "si",
       -- tolerando Si/Sí/SI del modelo sin volver a premiar "Whatsapp".
       calif_global  INTEGER GENERATED ALWAYS AS (
         CASE WHEN analisis LIKE '%Buzón de voz%' THEN NULL
         ELSE (CASE WHEN presentacion ~* '^s[ií]' THEN 10 ELSE 0 END)
            + (CASE WHEN precalif     ~* '^s[ií]' THEN 25 ELSE 0 END)
            + (CASE WHEN exploracion  ~* '^s[ií]' THEN 30 ELSE 0 END)
            + (CASE WHEN agenda       ~* '^s[ií]' THEN 35 ELSE 0 END)
         END
       ) STORED
     )`,
  );
  // Todas las lecturas del reporte son por cliente y rango de fechas.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS calls_lookup_idx ON ${CALLS_TABLE} (client_id, fecha)`,
  );
  // El barrido busca lo que quedó a medias; parcial para no indexar los estados
  // terminales ('analizada', 'descartada'), que con el tiempo son la mayoría.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS calls_pendientes_idx
       ON ${CALLS_TABLE} (estado, intentos)
       WHERE estado IN ('recibida','transcrita','fallida')`,
  );
  console.log('[db] Schema ready (clients, schedules, jobs, token_log, report_metrics, advisors, calls)');
}

// ── Generic keyed-jsonb helpers ─────────────────────────────────────────────
// `table` is always one of the constants above (never user input), so the
// interpolation below is safe from injection.

export async function dbLoadAll<T>(table: string): Promise<T[]> {
  const { rows } = await pool!.query(
    `SELECT data FROM ${table} ORDER BY created_at ASC`,
  );
  return rows.map((r) => r.data as T);
}

export async function dbGet<T>(table: string, id: string): Promise<T | undefined> {
  const { rows } = await pool!.query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
  return rows.length ? (rows[0].data as T) : undefined;
}

export async function dbUpsert(table: string, id: string, data: unknown): Promise<void> {
  await pool!.query(
    `INSERT INTO ${table} (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [id, data],
  );
}

export async function dbDelete(table: string, id: string): Promise<void> {
  await pool!.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

export async function dbCount(table: string): Promise<number> {
  const { rows } = await pool!.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n as number;
}
