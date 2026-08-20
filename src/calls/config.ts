import { callsDb, quoteIdent } from './db';

// ─────────────────────────────────────────────────────────────────────────────
// Configuración del pipeline por CUENTA (schema), no por cliente.
//
// Va por cuenta porque dos clientes pueden compartir una —Midstorage y Grupo
// Tactical— y las llamadas se transcriben una sola vez para ambos: el contexto
// del negocio y la fecha desde la que se analiza tienen que ser únicos, o el
// mismo audio se procesaría distinto según quién preguntara.
//
// En tabla propia y con prefijo `zebra_`: `callpicker_registro.cuentas` la
// administra el equipo de datos y no es nuestra para añadirle columnas.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG_TABLE = 'public.zebra_calls_config';

export interface CallsConfig {
  esquema:          string;
  /** Solo se analizan llamadas desde esta fecha. null = no analizar histórico. */
  desde:            string | null;
  contexto_negocio: string | null;
}

export async function ensureConfigTable(): Promise<void> {
  await callsDb().query(`
    CREATE TABLE IF NOT EXISTS ${CONFIG_TABLE} (
      esquema          TEXT PRIMARY KEY,
      desde            DATE,
      contexto_negocio TEXT,
      actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

export async function getConfig(esquema: string): Promise<CallsConfig | undefined> {
  try {
    const { rows } = await callsDb().query(
      `SELECT esquema, to_char(desde,'YYYY-MM-DD') AS desde, contexto_negocio
         FROM ${CONFIG_TABLE} WHERE esquema = $1`, [esquema]);
    return rows[0] as CallsConfig | undefined;
  } catch (e) {
    // 42P01 = la tabla todavía no existe (nadie ha activado ninguna cuenta).
    // Es un estado normal al estrenar, no un fallo: se cae a los valores por
    // defecto en vez de tumbar el barrido.
    if ((e as { code?: string }).code === '42P01') return undefined;
    throw e;
  }
}

export async function setConfig(
  esquema: string, desde: string | null, contexto: string | null,
): Promise<void> {
  await callsDb().query(
    `INSERT INTO ${CONFIG_TABLE} (esquema, desde, contexto_negocio)
     VALUES ($1, $2::date, $3)
     ON CONFLICT (esquema) DO UPDATE
       SET desde = EXCLUDED.desde, contexto_negocio = EXCLUDED.contexto_negocio,
           actualizado_en = now()`,
    [esquema, desde, contexto]);
}

/**
 * Crea la tabla `analisis` del schema. Es lo que habilita a una cuenta: el
 * pipeline procesa exactamente las cuentas que tienen dónde escribir.
 *
 * La fórmula de `calif_global` corrige el error de la hoja: la original usaba
 * HALLAR("S", ...), que busca la letra suelta, y "Whatsapp" cobraba los 35
 * puntos de agendamiento pese a significar que el asesor nunca intentó agendar.
 */
export async function ensureAnalisisTable(esquema: string): Promise<boolean> {
  const esq = quoteIdent(esquema);
  const { rows } = await callsDb().query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = 'analisis'`, [esquema]);
  if (rows.length > 0) return false;   // ya existía

  await callsDb().query(`
    CREATE TABLE ${esq}.analisis (
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
  await callsDb().query(
    `CREATE INDEX IF NOT EXISTS analisis_pendientes_idx ON ${esq}.analisis (estado, intentos)
      WHERE estado IN ('pendiente','transcrita','fallida')`);
  return true;
}

export interface EsquemaInfo {
  esquema:      string;
  total:        number;
  analizables:  number;
  ya_analizadas: number;
  desde:        string | null;
  hasta:        string | null;
  /** Analizables por mes: [{ mes: '2026-08', n: 42 }] */
  por_mes:      Array<{ mes: string; n: number }>;
  asesores:     string[];
  habilitado:   boolean;
}

/**
 * Los schemas que sirven como fuente, con lo necesario para decidir desde qué
 * fecha analizar: cuántas llamadas hay por mes que superen el umbral. Sin ese
 * desglose, elegir la fecha es adivinar cuánto va a costar.
 */
export async function listEsquemas(minDuracion = 100): Promise<EsquemaInfo[]> {
  const db = callsDb();
  const { rows: esquemas } = await db.query(`
    SELECT t.table_schema AS esquema,
           EXISTS (SELECT 1 FROM information_schema.tables x
                    WHERE x.table_schema = t.table_schema AND x.table_name = 'analisis') AS habilitado
      FROM information_schema.tables t
     WHERE t.table_name = 'llamadas'
       -- Tiene que traer TODAS las columnas que usa el pipeline, no solo
       -- llamarse igual: hay otra tabla llamadas en el schema crm que es otra
       -- cosa y reventaba la consulta al no tener n_grabaciones.
       AND (SELECT count(*) FROM information_schema.columns c
             WHERE c.table_schema = t.table_schema AND c.table_name = 'llamadas'
               AND c.column_name IN ('cuenta','call_id','fecha','asesor',
                                     'duracion_seg','n_grabaciones','grabaciones')) = 7
     ORDER BY 1`);

  const out: EsquemaInfo[] = [];
  for (const e of esquemas) {
    const esq = quoteIdent(e.esquema);
    const TZ = "(fecha AT TIME ZONE 'America/Mexico_City')";
    const { rows: [r] } = await db.query(`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE n_grabaciones > 0 AND duracion_seg >= $1)::int analizables,
             to_char(min(${TZ}),'YYYY-MM-DD') desde, to_char(max(${TZ}),'YYYY-MM-DD') hasta
        FROM ${esq}.llamadas`, [minDuracion]);
    const { rows: meses } = await db.query(`
      SELECT to_char(${TZ},'YYYY-MM') mes, count(*)::int n
        FROM ${esq}.llamadas
       WHERE n_grabaciones > 0 AND duracion_seg >= $1
       GROUP BY 1 ORDER BY 1`, [minDuracion]);
    const { rows: as } = await db.query(
      `SELECT DISTINCT asesor FROM ${esq}.llamadas WHERE asesor IS NOT NULL ORDER BY 1`);
    let ya = 0;
    if (e.habilitado) {
      const { rows: [y] } = await db.query(
        `SELECT count(*)::int n FROM ${esq}.analisis WHERE estado = 'analizada'`);
      ya = y.n;
    }
    out.push({
      esquema: e.esquema, total: r.total, analizables: r.analizables, ya_analizadas: ya,
      desde: r.desde, hasta: r.hasta,
      por_mes: meses.map((m: any) => ({ mes: m.mes, n: m.n })),
      asesores: as.map((a: any) => a.asesor),
      habilitado: e.habilitado,
    });
  }
  return out;
}
