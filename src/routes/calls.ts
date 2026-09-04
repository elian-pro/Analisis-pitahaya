import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loadClients } from '../clients/manager';
import { listAdvisors } from '../advisors/store';
import { normalizeAdvisorName } from '../advisors/match';
import { listCuentas, listCuentasHabilitadas, getCuenta } from '../calls/registry';
import { tenantCuenta } from '../calls/tenant';
import type { AuthedRequest } from '../auth/middleware';
import {
  listCalls, getCall, countByEstado, asesoresDelPeriodo, reactivarFallidas,
  type CallEstadoUI,
} from '../calls/store';
import { processCall, matchClient, minDuracion } from '../calls/pipeline';
import { sweepOnce, DESDE } from '../calls/sweeper';
import { callsDbEnabled, explainConnError, callsDb, callsDbInfo } from '../calls/db';
import {
  listEsquemas, ensureAnalisisTable, ensureConfigTable,
  setConfig, setAuto, listConfigs, getConfig, debeBarrer,
} from '../calls/config';

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

// Los dos campos son opcionales y nullable: ausente = "no toques", null = "sin
// valor". Distinguirlos es lo que evita que guardar una cosa borre la otra.
const ConfigPatchSchema = z.object({
  desde:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contexto_negocio: z.string().nullable().optional(),
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
    // Solo lo que venga en el cuerpo. `desde: null` explicito sigue queriendo
    // decir "de aqui en adelante" (se guarda hoy); `desde` AUSENTE quiere decir
    // "no toques la fecha que ya tenia", que es lo que hace falta cuando el
    // asistente guarda un cliente por cualquier otro motivo.
    const patch: { desde?: string | null; contexto_negocio?: string } = {};
    if (desde !== undefined)            patch.desde = desde ?? hoy;
    if (contexto_negocio !== undefined) patch.contexto_negocio = contexto_negocio;
    await setConfig(esquema, patch);

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

/**
 * Cuentas disponibles: alimenta el selector de la pestaña Llamadas y la sección
 * "Análisis automático" de Ajustes.
 *
 * Todo en una sola respuesta y con consultas baratas —el registro, los clientes
 * y la tabla de config entera— porque esto se pide al abrir Ajustes. Lo caro
 * (`listEsquemas`, que son 1+4×N escaneos completos de `llamadas`) se queda
 * fuera a propósito: vive en `/esquemas` y solo lo pide el asistente.
 *
 * Los contadores sí exigen una consulta por origen, así que solo se calculan
 * para los habilitados: `countByEstado` hace JOIN contra `analisis` y en un
 * schema sin esa tabla reventaría.
 */
router.get('/cuentas', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Cliente externo: su única cuenta es su propia base. Nada del registro de
    // Callpicker (ni sus slugs, ni sus contadores) sale hacia un tenant.
    const user = (_req as AuthedRequest).user;
    if (user?.role === 'client') {
      const cuenta = await tenantCuenta(user.client_id!);
      if (!cuenta) { res.json({ desde: null, cuentas: [] }); return; }
      let counts: Record<string, number> | null = null;
      try { counts = await countByEstado(cuenta, undefined, minDuracion(undefined)); }
      catch (e) { console.warn(`[calls] contadores de ${cuenta.slug}:`, (e as Error).message); }
      res.json({ desde: null, cuentas: [{
        ...cuenta, tiene_cliente: true, auto: true, configurado: true,
        desde: null, contexto_propio: false, clientes: [], counts,
      }] });
      return;
    }
    const [cuentas, clients, configs] = await Promise.all([
      listCuentas(), loadClients(), listConfigs(),
    ]);
    const cfgDe = new Map(configs.map(c => [c.esquema, c]));

    const filas = await Promise.all(cuentas.map(async (c) => {
      const cfg = cfgDe.get(c.esquema);
      // Los clientes que LEEN de este origen. Pueden ser dos —Midstorage y
      // Grupo Tactical comparten cuenta— y lo que los separa es su roster.
      const vinculados = clients.filter(x => x.calls_schema === c.esquema);
      let counts: Record<string, number> | null = null;
      if (c.habilitada) {
        // Mismo umbral que la pestaña Llamadas (`minDuracion(matchClient(...))`),
        // o la tarjeta diría "3 sin procesar" y la pestaña otra cosa.
        try { counts = await countByEstado(c, cfg?.desde ?? undefined, minDuracion(matchClient(c, clients))); }
        catch (e) { console.warn(`[calls] contadores de ${c.esquema}:`, (e as Error).message); }
      }
      return {
        ...c,
        // Si no empareja con ningún cliente de Zebra Reports, se usan los
        // prompts por defecto: conviene que se vea en la UI.
        tiene_cliente: clients.some(x => x.id === c.slug || x.name === c.cliente),
        // El interruptor de Ajustes. Sin fila de config el barrido no lo toca,
        // así que se reporta como apagado y no como "encendido por defecto".
        auto:          cfg ? cfg.auto : false,
        configurado:   Boolean(cfg),
        desde:         cfg?.desde ?? null,
        // El contenido no viaja: puede ser largo y aquí solo hace falta saber si
        // esta cuenta pisa el contexto de sus clientes.
        contexto_propio: Boolean(cfg?.contexto_negocio?.trim()),
        clientes: vinculados.map(x => ({ id: x.id, name: x.name })),
        counts,
      };
    }));

    res.json({ desde: DESDE, cuentas: filas });
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
  let { cuenta: slug } = parsed.data;
  const { estado, desde, hasta, limit } = parsed.data;
  const user = (req as AuthedRequest).user;
  // El tenant queda clavado a su propia cuenta pida lo que pida.
  if (user?.role === 'client') slug = user.client_id!;
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

/**
 * "Reprocesar pendientes", el botón de la pestaña. Literal, así que va antes que
 * las rutas con parámetro o Express leería 'reprocess' como un call_id (misma
 * nota que en report.ts:259).
 *
 * Antes de barrer devuelve al pipeline las llamadas que agotaron sus tres
 * intentos: sin eso el botón contestaba "0 procesadas" teniendo 34 llamadas en
 * rojo delante, porque el barrido las da por perdidas para siempre y el humano
 * que pulsa no tenía otra forma de decir "vuelve a intentarlo".
 *
 * Solo en los orígenes que el barrido va a mirar. Reactivarlas en uno con el
 * análisis automático apagado las dejaría en 'pendiente' sin nadie que las
 * procese: peor que no tocarlas, porque desaparecerían del contador de fallidas
 * sin que nada avance. `pausados` dice cuáles se quedaron fuera y por qué.
 */
router.post('/reprocess', async (req: Request, res: Response): Promise<void> => {
  try {
    const clients = await loadClients();
    const barridas = [];
    let reactivadas = 0;
    for (const cuenta of await listCuentasHabilitadas()) {
      const cfg = await getConfig(cuenta.esquema);
      if (!debeBarrer(cfg)) continue;
      barridas.push({ cuenta, desde: cfg?.desde ?? DESDE });
      reactivadas += await reactivarFallidas(cuenta, cfg?.desde ?? DESDE);
    }
    const r = await sweepOnce(Number(req.query.lote) || undefined);

    // Lo que queda en cola DESPUÉS de esta vuelta. El barrido toma cinco por
    // minuto, así que reactivar 33 y contestar "5 procesadas" se leía como que
    // las otras 28 se habían vuelto a quedar fuera. Se cuenta de la base y no
    // restando: en la cola también hay llamadas que nunca fallaron.
    const enCola = await Promise.all(barridas.map(async ({ cuenta, desde }) => {
      const c = await countByEstado(cuenta, desde, minDuracion(matchClient(cuenta, clients)));
      return (c.pendiente ?? 0) + (c.transcrita ?? 0) + (c.sin_procesar ?? 0);
    }));

    res.json({ ...r, reactivadas, pendientes: enCola.reduce((a, n) => a + n, 0) });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

const AutoSchema = z.object({ auto: z.boolean() });

/**
 * El interruptor de "Análisis automático" de un origen.
 *
 * Va aquí arriba, con las literales, por la misma razón que `/reprocess`: si
 * algún día se añade `GET /origenes/:esquema` (dos segmentos), `/:slug/:call_id`
 * se lo tragaría. El schema llega con espacios y mayúsculas ("Grupo Gira"), que
 * Express decodifica solo; el frontend lo manda con encodeURIComponent.
 */
router.post('/origenes/:esquema/auto', async (req: Request, res: Response): Promise<void> => {
  const parsed = AutoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Falta el campo "auto" (true o false).' });
    return;
  }
  const esquema = req.params.esquema;
  try {
    // Contra el registro y no contra la lista de schemas: los orígenes que se
    // ven en Ajustes salen de ahí, y sin esta comprobación un nombre mal escrito
    // dejaría en la tabla una fila fantasma que nadie va a leer nunca.
    const cuentas = await listCuentas();
    const cuenta  = cuentas.find(c => c.esquema === esquema);
    if (!cuenta) {
      res.status(404).json({ error: `No hay ningún origen con el schema '${esquema}'.` });
      return;
    }
    if (!cuenta.habilitada && parsed.data.auto) {
      res.status(409).json({
        error: `'${esquema}' todavía no tiene tabla de análisis. Se crea al elegir este `
             + `origen en el paso Fuente de un cliente, que es donde se decide desde qué `
             + `fecha analizar.`,
      });
      return;
    }
    await ensureConfigTable();
    await setAuto(esquema, parsed.data.auto);
    res.json({ ok: true, esquema, auto: parsed.data.auto });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

/**
 * Quién se queda las llamadas de un origen, y quién no se las queda nadie.
 *
 * Es el diagnóstico de una cuenta compartida, y son los dos fallos que hoy no
 * tienen forma de verse: un asesor que no está en el roster de ningún cliente
 * vinculado no aparece en NINGÚN reporte, y uno que está en dos rosters cuenta
 * sus llamadas dos veces, en dos reportes distintos que se le entregan a dos
 * clientes. Nada falla; los números simplemente salen mal.
 *
 * Aparte de `/cuentas` porque cuesta una consulta por cliente vinculado y solo
 * hace falta al abrir los ajustes avanzados de un origen.
 */
router.get('/origenes/:esquema/asesores', async (req: Request, res: Response): Promise<void> => {
  const esquema = req.params.esquema;
  try {
    const [cuentas, clients, cfg] = await Promise.all([
      listCuentas(), loadClients(), getConfig(esquema),
    ]);
    const cuenta = cuentas.find(c => c.esquema === esquema);
    if (!cuenta) {
      res.status(404).json({ error: `No hay ningún origen con el schema '${esquema}'.` });
      return;
    }

    const vinculados = clients.filter(x => x.calls_schema === esquema);
    const enLlamadas = await asesoresDelPeriodo(
      cuenta, cfg?.desde ?? undefined, minDuracion(matchClient(cuenta, clients)));

    // Cada nombre del roster, con los clientes que lo reclaman. El mismo
    // normalizado que usa el filtro real en SQL (lower + btrim), o el aviso
    // contradiría a los reportes.
    const duenos = new Map<string, { nombre: string; clientes: string[] }>();
    const rosters = await Promise.all(vinculados.map(async (c) => ({
      id: c.id, name: c.name,
      asesores: (await listAdvisors(c.id, { includeInactive: true })).map(a => a.name),
    })));
    for (const r of rosters) {
      for (const nombre of r.asesores) {
        const k = normalizeAdvisorName(nombre);
        // La clave va normalizada para comparar, pero lo que se enseña es el
        // nombre tal como lo escribieron: "ernesto marín" en un aviso parece
        // otro error mas.
        const y = duenos.get(k) ?? { nombre, clientes: [] };
        y.clientes.push(r.name);
        duenos.set(k, y);
      }
    }

    const conLlamadas = new Set(enLlamadas.map(a => normalizeAdvisorName(a.asesor)));
    res.json({
      esquema,
      desde: cfg?.desde ?? null,
      clientes: rosters.map(r => ({ id: r.id, name: r.name, asesores: r.asesores.length })),
      // Nombres en las llamadas que no reclama nadie: sus llamadas no entran en
      // ningún reporte. Parte de lo que sale aquí es ruido del proveedor
      // ("whats", "Zebra"), así que se devuelve con el conteo y que decida quien
      // mira.
      sin_dueno: enLlamadas
        .filter(a => !duenos.has(normalizeAdvisorName(a.asesor)))
        .map(a => ({ asesor: a.asesor, llamadas: a.n })),
      // El caso caro: dos clientes reclaman al mismo asesor.
      duplicados: [...duenos.values()]
        .filter(d => d.clientes.length > 1)
        .map(d => ({ asesor: d.nombre, clientes: d.clientes })),
      // El typo al dar de alta a alguien: está en el roster y no llama nunca.
      sin_llamadas: [...duenos.entries()]
        .filter(([k]) => !conLlamadas.has(k))
        .map(([, d]) => d.nombre),
    });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

/**
 * La configuración de un origen, con el texto del contexto incluido.
 *
 * Aparte de `/cuentas` porque ahí solo viaja un booleano —el contexto puede ser
 * largo y se pide para los tres orígenes a la vez—, y porque el formulario de
 * avanzados NECESITA el texto: sin él, abrir y guardar lo borraría.
 */
router.get('/origenes/:esquema/config', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json((await getConfig(req.params.esquema)) ?? {
      esquema: req.params.esquema, desde: null, contexto_negocio: null, auto: false,
    });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

/** Los avanzados de un origen: desde cuándo analizar y su contexto de negocio. */
router.post('/origenes/:esquema/config', async (req: Request, res: Response): Promise<void> => {
  const parsed = ConfigPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  const esquema = req.params.esquema;
  try {
    const cuentas = await listCuentas();
    if (!cuentas.some(c => c.esquema === esquema)) {
      res.status(404).json({ error: `No hay ningún origen con el schema '${esquema}'.` });
      return;
    }
    await ensureConfigTable();
    // Solo lo que venga: el cuerpo puede traer una cosa, la otra o las dos.
    await setConfig(esquema, parsed.data);
    res.json({ ok: true, esquema, ...(await getConfig(esquema)) });
  } catch (e) {
    res.status(500).json({ error: explainConnError(e) });
  }
});

router.get('/:slug/:call_id', async (req: Request, res: Response): Promise<void> => {
  try {
    // Un tenant solo puede abrir llamadas de su propia cuenta. 404 y no 403:
    // no se confirma que el slug ajeno exista.
    const user = (req as AuthedRequest).user;
    if (user?.role === 'client' && req.params.slug !== user.client_id) {
      res.status(404).json({ error: 'Cuenta no encontrada' });
      return;
    }
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
