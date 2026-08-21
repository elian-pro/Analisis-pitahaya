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
  /**
   * El interruptor de "Análisis automático" de Ajustes. Se llama `auto` y no
   * `activa` para no colisionar con `Cuenta.activa`, que es una columna del
   * registro de Callpicker, la administra otro equipo y significa otra cosa;
   * las dos viajan juntas en el JSON de la pestaña.
   */
  auto:             boolean;
}

export async function ensureConfigTable(): Promise<void> {
  await callsDb().query(`
    CREATE TABLE IF NOT EXISTS ${CONFIG_TABLE} (
      esquema          TEXT PRIMARY KEY,
      desde            DATE,
      contexto_negocio TEXT,
      actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Por separado y con IF NOT EXISTS: la tabla ya existe en producción con la
  // forma vieja, y este es el único camino que la actualiza sin migración aparte.
  // DEFAULT true porque activar un origen ya es un acto humano explícito (crear
  // su tabla `analisis` desde el asistente) y quien lo hizo no espera tener que
  // encenderlo dos veces.
  await callsDb().query(
    `ALTER TABLE ${CONFIG_TABLE} ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT true`);
}

const SELECT_CONFIG =
  `SELECT esquema, to_char(desde,'YYYY-MM-DD') AS desde, contexto_negocio, auto FROM ${CONFIG_TABLE}`;

/**
 * 42P01 = la tabla todavía no existe (nadie ha activado ninguna cuenta) y 42703
 * = existe pero sin la columna `auto` todavía. Los dos son estados normales de
 * una instalación a medio estrenar, no fallos: se cae a los valores por defecto
 * en vez de tumbar el barrido o la pantalla de Ajustes.
 */
const esTablaSinPreparar = (e: unknown): boolean =>
  ['42P01', '42703'].includes((e as { code?: string }).code ?? '');

export async function getConfig(esquema: string): Promise<CallsConfig | undefined> {
  try {
    const { rows } = await callsDb().query(`${SELECT_CONFIG} WHERE esquema = $1`, [esquema]);
    return rows[0] as CallsConfig | undefined;
  } catch (e) {
    if (esTablaSinPreparar(e)) return undefined;
    throw e;
  }
}

/** Todas las configuraciones de una vez, para pintar la pestaña de Ajustes. */
export async function listConfigs(): Promise<CallsConfig[]> {
  try {
    const { rows } = await callsDb().query(`${SELECT_CONFIG} ORDER BY esquema`);
    return rows as CallsConfig[];
  } catch (e) {
    if (esTablaSinPreparar(e)) return [];
    throw e;
  }
}

export interface ConfigPatch {
  /** Ausente = no tocar. `null` explícito = no analizar histórico. */
  desde?:            string | null;
  contexto_negocio?: string | null;
}

/**
 * Escribe SOLO lo que viene. Antes escribía los tres campos siempre, y eso tenía
 * una consecuencia que nadie veía: el asistente de cliente llama a `/activar` en
 * cada guardado mandando únicamente `{esquema, desde}`, con `desde` recalculado
 * al último mes con llamadas. Así que editar la carpeta de Drive de un cliente
 * de Postgres le movía la fecha de inicio hacia adelante y abandonaba el backlog,
 * y de paso borraba el contexto de negocio de la cuenta.
 *
 * `auto` no entra nunca por aquí: se cambia solo desde su interruptor, para que
 * un guardado del asistente no reactive un origen que alguien puso en pausa.
 */
export async function setConfig(esquema: string, patch: ConfigPatch = {}): Promise<void> {
  const tocaDesde    = 'desde' in patch;
  const tocaContexto = 'contexto_negocio' in patch;
  await callsDb().query(
    `INSERT INTO ${CONFIG_TABLE} (esquema, desde, contexto_negocio)
     VALUES ($1, $2::date, $3)
     ON CONFLICT (esquema) DO UPDATE
       SET desde            = CASE WHEN $4 THEN EXCLUDED.desde            ELSE ${CONFIG_TABLE}.desde END,
           contexto_negocio = CASE WHEN $5 THEN EXCLUDED.contexto_negocio ELSE ${CONFIG_TABLE}.contexto_negocio END,
           actualizado_en   = now()`,
    [esquema, patch.desde ?? null, patch.contexto_negocio ?? null, tocaDesde, tocaContexto]);
}

/** El interruptor. Crea la fila si el origen aún no tenía configuración. */
export async function setAuto(esquema: string, auto: boolean): Promise<void> {
  await callsDb().query(
    `INSERT INTO ${CONFIG_TABLE} (esquema, auto) VALUES ($1, $2)
     ON CONFLICT (esquema) DO UPDATE SET auto = EXCLUDED.auto, actualizado_en = now()`,
    [esquema, auto]);
}

/**
 * Si el barrido debe tocar este origen. Función pura y aparte del sweeper a
 * propósito: es la única lógica del interruptor que se puede probar sin base de
 * datos, y `sweeper.ts` arrastra `config/env` (que hace process.exit al importar
 * sin credenciales) hasta el runner de tests.
 *
 * Sin fila de configuración NO se barre. Importa desde que el barrido dejó de
 * depender de una variable de entorno: `.env.example` documenta crear la tabla
 * `analisis` a mano, y sin esta regla cualquier schema con esa tabla se pondría
 * a procesar su histórico en el primer tick sin que nadie lo hubiera pedido.
 */
export function debeBarrer(cfg?: CallsConfig): boolean {
  return cfg !== undefined && cfg.auto !== false;
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
