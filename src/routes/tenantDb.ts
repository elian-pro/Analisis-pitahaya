import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../auth/middleware';
import {
  getTenantDbConfig, saveTenantDbConfig, sealPassword, tenantPool, probeTenantDb,
  ensureTenantSchema, TENANT_SCHEMA_DEFAULT, type TenantDbConfig,
} from '../calls/tenant';
import { getClient } from '../clients/manager';
import { dbEnabled } from '../config/db';
import { humanizeError } from '../humanizeError';

// ─────────────────────────────────────────────────────────────────────────────
// Conexión a la base Postgres de un cliente externo. El admin la configura y
// provisiona; el cliente solo ve su estado y puede probarla. La contraseña
// jamás vuelve al navegador: el GET devuelve password_set y nada más.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

/** El client_id efectivo: el suyo si es rol client, el pedido si es admin. */
function resolveClientId(req: AuthedRequest): string | undefined {
  if (req.user?.role === 'client') return req.user.client_id;
  const q = req.query.client_id ?? (req.body as Record<string, unknown> | undefined)?.client_id;
  return typeof q === 'string' && q ? q : undefined;
}

const redacted = (cfg: TenantDbConfig) => ({
  host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user,
  ssl: cfg.ssl, schema: cfg.schema, desde: cfg.desde ?? null,
  password_set: !!cfg.password_enc, probado_en: cfg.probado_en ?? null,
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const clientId = resolveClientId(req as AuthedRequest);
  if (!clientId) {
    res.status(400).json({ error: 'Falta client_id.' });
    return;
  }
  const cfg = await getTenantDbConfig(clientId);
  res.json(cfg ? { configured: true, ...redacted(cfg) } : { configured: false });
});

const SaveSchema = z.object({
  client_id: z.string().min(1),
  host:      z.string().min(1),
  port:      z.number().int().min(1).max(65535).default(5432),
  database:  z.string().min(1),
  user:      z.string().min(1),
  password:  z.string().min(1).optional(),  // opcional al editar: se conserva la guardada
  ssl:       z.boolean().default(true),
  schema:    z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).default(TENANT_SCHEMA_DEFAULT),
  desde:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

router.put('/', async (req: Request, res: Response): Promise<void> => {
  if (!dbEnabled) {
    res.status(503).json({ error: 'La base del cliente requiere DATABASE_URL.' });
    return;
  }
  const parsed = SaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  const d = parsed.data;
  if (!(await getClient(d.client_id))) {
    res.status(400).json({ error: `No existe el cliente ${d.client_id}.` });
    return;
  }
  const previa = await getTenantDbConfig(d.client_id);
  if (!d.password && !previa) {
    res.status(400).json({ error: 'Falta la contraseña de la base.' });
    return;
  }
  const cfg: TenantDbConfig = {
    host: d.host.trim(), port: d.port, database: d.database.trim(), user: d.user.trim(),
    ssl: d.ssl, schema: d.schema, desde: d.desde ?? previa?.desde ?? null,
    password_enc: d.password ? sealPassword(d.password) : previa!.password_enc,
    probado_en: previa?.probado_en ?? null,
  };
  try {
    await saveTenantDbConfig(d.client_id, cfg);
    res.json({ ok: true, ...redacted(cfg) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Prueba la conexión ANTES de generar nada: el error de credenciales se ve aquí
// y no dentro de un job de cinco minutos.
router.post('/test', async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthedRequest).user;
  const clientId = resolveClientId(req as AuthedRequest);
  const stored = clientId ? await getTenantDbConfig(clientId) : undefined;

  // Credenciales inline (wizard, ANTES de guardar): solo para el admin. Para un
  // tenant esto sería una sonda de red con hosts arbitrarios.
  const b = req.body as Record<string, unknown> | undefined;
  let cfg = stored;
  if (b?.host && user?.role !== 'client') {
    const password_enc = typeof b.password === 'string' && b.password
      ? sealPassword(b.password) : stored?.password_enc;
    if (!password_enc) {
      res.status(400).json({ error: 'Falta la contraseña de la base.' });
      return;
    }
    cfg = {
      host: String(b.host).trim(), port: Number(b.port) || 5432,
      database: String(b.database ?? '').trim(), user: String(b.user ?? '').trim(),
      ssl: b.ssl !== false && b.ssl !== 'false',
      schema: typeof b.schema === 'string' && b.schema ? b.schema : TENANT_SCHEMA_DEFAULT,
      password_enc,
    };
  }
  if (!cfg) {
    res.status(404).json({ error: 'Este cliente no tiene base de datos configurada.' });
    return;
  }
  try {
    const r = await probeTenantDb(cfg);
    if (stored && cfg === stored && clientId) {
      await saveTenantDbConfig(clientId, { ...stored, probado_en: new Date().toISOString() });
    }
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(502).json({ ok: false, error: humanizeError((e as Error).message) });
  }
});

// Crea (idempotente) el esquema estándar en la base del cliente.
router.post('/provision', async (req: Request, res: Response): Promise<void> => {
  const clientId = resolveClientId(req as AuthedRequest);
  if (!clientId) {
    res.status(400).json({ error: 'Falta client_id.' });
    return;
  }
  const cfg = await getTenantDbConfig(clientId);
  if (!cfg) {
    res.status(404).json({ error: 'Configura la conexión antes de crear la estructura.' });
    return;
  }
  try {
    await ensureTenantSchema(await tenantPool(clientId, cfg), cfg.schema);
    res.json({ ok: true, schema: cfg.schema });
  } catch (e) {
    res.status(502).json({ error: humanizeError((e as Error).message) });
  }
});

export default router;
