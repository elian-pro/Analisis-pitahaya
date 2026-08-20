import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loadClients } from '../clients/manager';
import { listCuentas, listCuentasHabilitadas, getCuenta } from '../calls/registry';
import { listCalls, getCall, countByEstado, type CallEstadoUI } from '../calls/store';
import { processCall, matchClient, minDuracion } from '../calls/pipeline';
import { sweepOnce, DESDE } from '../calls/sweeper';
import { callsDbEnabled, explainConnError, callsDb, callsDbInfo } from '../calls/db';
import { listEsquemas, ensureAnalisisTable, ensureConfigTable, setConfig } from '../calls/config';

// ─────────────────────────────────────────────────────────────────────────────
// API de la pestaña de llamadas. Toda detrás de la sesión, como el resto de
// /api: ya no hay webhook público, porque Callpicker escribe directo en su base
// y el pipeline lee de ahí.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

/**
 * Diagnóstico de la conexión. Va ANTES del guard a propósito: tiene que poder
 * responder justo cuando la configuración está mal, que es cuando hace falta.
 * No devuelve la contraseña.
 */
router.get('/diagnostico', async (_req: Request, res: Response): Promise<void> => {
  const info = callsDbInfo();
  if (!info.configurada) {
    res.json({ ...info, conexion: { ok: false, error: 'Falta CALLS_DATABASE_URL.' } });
    return;
  }
  const t = Date.now();
  try {
    const { rows: [r] } = await callsDb().query(
      `SELECT current_database() AS base, current_user AS usuario,
              (SELECT count(*)::int FROM information_schema.tables
                WHERE table_name = 'llamadas') AS tablas_llamadas`);
    res.json({ ...info, conexion: { ok: true, ms: Date.now() - t, ...r } });
  } catch (e) {
    res.json({ ...info, conexion: { ok: false, ms: Date.now() - t, error: explainConnError(e) } });
  }
});

// Sin la base de llamadas configurada, cualquier ruta de aqui fallaria con un
// error de conexion crudo. Un 503 con el nombre de la variable que falta dice
// que hacer; un 500 solo dice que algo se rompio. Cubre todas las rutas de una,
// en vez de repetir la comprobacion en cada una.
router.use((_req: Request, res: Response, next: NextFunction): void => {
  if (callsDbEnabled()) { next(); return; }
  res.status(503).json({
    error: 'El pipeline de llamadas no está configurado: falta la variable '
         + 'CALLS_DATABASE_URL (la base donde Callpicker escribe las llamadas).',
  });
});

const ESTADOS = ['pendiente','descartada','transcrita','analizada','fallida','sin_procesar','corta'] as const;

const ListQuerySchema = z.object({
  cuenta: z.string().optional(),
  estado: z.enum(ESTADOS).optional(),
  desde:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:  z.coerce.number().int().min(1).max(1000).optional(),
});

/**
 * Los schemas que pueden servir de fuente, con lo necesario para decidir desde
 * que fecha analizar: cuantas llamadas hay por mes que superen el umbral.
 */
router.get('/esquemas', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ esquemas: await listEsquemas() });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

const ActivarSchema = z.object({
  esquema:          z.string().min(1),
  // null = no analizar el historico. Se guarda la fecha de HOY en vez de un null
  // especial: "de aqui en adelante" es una fecha como cualquier otra y evita un
  // caso aparte en el barrido.
  desde:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contexto_negocio: z.string().optional(),
});

/**
 * Activa una cuenta: crea su tabla `analisis` y guarda desde cuando analizar.
 * Con la tabla creada el barrido la recoge solo en el siguiente tick, asi que
 * no hay nada mas que disparar.
 */
router.post('/activar', async (req: Request, res: Response): Promise<void> => {
  const parsed = ActivarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  const { esquema, desde, contexto_negocio } = parsed.data;
  try {
    await ensureConfigTable();
    const creada = await ensureAnalisisTable(esquema);
    const hoy = new Date().toISOString().slice(0, 10);
    await setConfig(esquema, desde ?? hoy, contexto_negocio ?? null);

    // Cuantas quedan por procesar con esa fecha, para poder avisar del volumen.
    const info = (await listEsquemas()).find(e => e.esquema === esquema);
    const pendientes = desde
      ? (info?.por_mes ?? []).filter(m => m.mes >= desde.slice(0, 7)).reduce((a, m) => a + m.n, 0)
      : 0;
    res.json({ ok: true, creada, esquema, desde: desde ?? null, pendientes });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

/** Cuentas disponibles, para el selector de la pestaña. */
router.get('/cuentas', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [cuentas, clients] = await Promise.all([listCuentas(), loadClients()]);
    res.json({
      desde: DESDE,
      cuentas: cuentas.map(c => ({
        ...c,
        // Si no empareja con ningún cliente de Zebra Reports, se usan los
        // prompts por defecto: conviene que se vea en la UI.
        tiene_cliente: clients.some(x => x.id === c.slug || x.name === c.cliente),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  const { cuenta: slug, estado, desde, hasta, limit } = parsed.data;
  try {
    // Sin cuenta explícita se usa la primera habilitada; hoy solo hay una.
    const cuenta = slug ? await getCuenta(slug) : (await listCuentasHabilitadas())[0];
    if (!cuenta) { res.json({ cuenta: null, counts: {}, calls: [] }); return; }
    // Una cuenta sin tabla `analisis` no se puede consultar: el LEFT JOIN falla
    // con un error de Postgres que al usuario no le dice nada.
    if (!cuenta.habilitada) {
      res.json({
        cuenta: { slug: cuenta.slug, cliente: cuenta.cliente, habilitada: false },
        counts: {}, calls: [],
        aviso: `${cuenta.cliente} todavia no esta activado: falta crear la tabla `
             + `analisis en el schema ${cuenta.esquema}.`,
      });
      return;
    }

    // El umbral del cliente decide qué cuenta como pendiente y qué como corta.
    const umbral = minDuracion(matchClient(cuenta, await loadClients()));
    const [calls, counts] = await Promise.all([
      listCalls(cuenta, { estado: estado as CallEstadoUI | undefined,
                          desde: desde ?? DESDE, hasta, limit, minDuracion: umbral }),
      countByEstado(cuenta, desde ?? DESDE, umbral),
    ]);
    // La transcripción pesa decenas de KB por fila y la lista no la muestra.
    res.json({
      cuenta: { slug: cuenta.slug, cliente: cuenta.cliente, habilitada: cuenta.habilitada },
      counts,
      calls: calls.map(c => ({ ...c, transcripcion: undefined,
                               tiene_transcripcion: Boolean(c.transcripcion) })),
    });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

// Las rutas literales van antes que las que llevan parámetro, para que Express
// no interprete 'reprocess' como un call_id. Misma nota que en report.ts:259.
router.post('/reprocess', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await sweepOnce(Number(req.query.lote) || undefined));
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

router.get('/:slug/:call_id', async (req: Request, res: Response): Promise<void> => {
  try {
    const cuenta = await getCuenta(req.params.slug);
    if (!cuenta) { res.status(404).json({ error: 'Cuenta no encontrada' }); return; }
    const call = await getCall(cuenta, req.params.call_id);
    if (!call) { res.status(404).json({ error: 'Llamada no encontrada' }); return; }
    res.json(call);
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

router.post('/:slug/:call_id/process', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await processCall(req.params.slug, req.params.call_id, req.query.force === 'true');
    res.status(r.ok ? 200 : 422).json(r);
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

export default router;
