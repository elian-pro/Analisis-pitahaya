import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { env, callsPipelineEnabled } from '../config/env';
import { checkWebhookToken, extractToken } from '../calls/webhookAuth';
import { ingestCall, processCall } from '../calls/pipeline';
import { listCalls, getCall, countByEstado, assignClient, type CallEstado } from '../calls/store';
import { sweepOnce } from '../calls/sweeper';

// ─────────────────────────────────────────────────────────────────────────────
// Dos routers, porque tienen autenticación distinta:
//
//   webhookRouter → PÚBLICO respecto a la sesión, con su propio token. Se monta
//                   ANTES de app.use('/api', requireApiAuth) en server.ts, que
//                   es el único mecanismo de exención que existe en este repo.
//   callsRouter   → detrás de la sesión, como el resto de /api.
// ─────────────────────────────────────────────────────────────────────────────

export const webhookRouter = Router();

webhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const auth = checkWebhookToken(
    extractToken(req.headers as Record<string, unknown>, req.query as Record<string, unknown>),
    env.CALLS_WEBHOOK_TOKEN,
  );
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  if (!callsPipelineEnabled()) {
    res.status(503).json({ error: 'El pipeline de llamadas está apagado (CALLS_PIPELINE=off).' });
    return;
  }

  // Un payload sin `call_id` es culpa del emisor: 400 para que NO lo reintente,
  // porque reenviarlo daría exactamente el mismo resultado.
  const payload = req.body ?? {};
  if (!payload.call_id) {
    res.status(400).json({ error: 'El evento no trae `call_id`.' });
    return;
  }

  try {
    const result = await ingestCall(payload);

    // Se responde antes de transcribir: el proveedor no debe esperar a Gemini, y
    // un timeout suyo provocaría reenvíos. Mismo patrón que routes/report.ts:59.
    res.status(202).json(result);

    if (result.nueva && result.estado === 'recibida') {
      processCall(result.call_id).catch(err =>
        console.error(`[calls] proceso de ${result.call_id} falló:`, err),
      );
    }
  } catch (e) {
    // Aquí solo quedan fallos NUESTROS (base caída, config incompleta). Tiene que
    // ser 5xx: con un 400 el proveedor daría la llamada por entregada y se
    // perdería para siempre, que es justo lo que este pipeline viene a evitar.
    const msg = (e as Error).message;
    console.error(`[calls] ingest de ${payload.call_id} falló:`, msg);
    res.status(500).json({ error: msg });
  }
});

// ── API del dashboard ────────────────────────────────────────────────────────

export const callsRouter = Router();

const ESTADOS = ['recibida', 'descartada', 'transcrita', 'analizada', 'fallida', 'sin_asignar'] as const;

const ListQuerySchema = z.object({
  client_id: z.string().optional(),
  estado:    z.enum(ESTADOS).optional(),
  from:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:     z.coerce.number().int().min(1).max(1000).optional(),
});

callsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  try {
    const [calls, counts] = await Promise.all([
      listCalls({ ...parsed.data, estado: parsed.data.estado as CallEstado | undefined }),
      countByEstado(parsed.data.client_id),
    ]);
    // La transcripción puede pesar decenas de KB y la lista no la muestra: se
    // recorta aquí para no mandar megas al navegador en cada refresco.
    res.json({
      counts,
      calls: calls.map(c => ({ ...c, transcripcion: undefined, raw: undefined,
                               tiene_transcripcion: Boolean(c.transcripcion) })),
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Las rutas literales van ANTES de las que llevan parámetro, para que Express
// no interprete 'reprocess' como un call_id. Misma nota que en report.ts:259.
callsRouter.post('/reprocess', async (req: Request, res: Response): Promise<void> => {
  const lote = Number(req.query.lote) || undefined;
  try {
    res.json(await sweepOnce(lote));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

callsRouter.get('/:call_id', async (req: Request, res: Response): Promise<void> => {
  try {
    const call = await getCall(req.params.call_id);
    if (!call) { res.status(404).json({ error: 'Llamada no encontrada' }); return; }
    res.json(call);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

callsRouter.post('/:call_id/process', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await processCall(req.params.call_id, req.query.force === 'true');
    res.status(result.ok ? 200 : 422).json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const AssignSchema = z.object({ client_id: z.string().min(1) });

callsRouter.post('/:call_id/assign', async (req: Request, res: Response): Promise<void> => {
  const parsed = AssignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Falta client_id' }); return; }
  try {
    await assignClient(req.params.call_id, parsed.data.client_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default callsRouter;
