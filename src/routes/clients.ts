import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { loadClients, getClient, createClient, updateClient, deleteClient } from '../clients/manager';

const router = Router();

const ClientBodySchema = z.object({
  name:                    z.string().min(1),
  folder_id:               z.string().min(1),
  sidecar_folder_id:       z.string().optional(),
  spreadsheet_id:          z.string().min(1),
  data_sheet_name:         z.string().min(1),
  col_fecha:               z.string().min(1),
  col_asesor:              z.string().min(1),
  col_calif:               z.string().min(1),
  col_analisis:            z.string().min(1),
  col_transcripcion:       z.string().min(1),
  col_duracion:            z.string().optional(),
  col_record:              z.string().optional(),
  excluded_phrases:        z.array(z.string()).default([]),
  transcripcion_max_chars: z.number().int().min(100).default(3000),
  prompt_individual:       z.string().min(1),
  prompt_general:          z.string().min(1),
});

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await loadClients());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const client = await getClient(req.params.id);
    if (!client) { res.status(404).json({ error: `Client '${req.params.id}' not found` }); return; }
    res.json(client);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = ClientBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(400).json({ error: msg });
    return;
  }
  try {
    res.status(201).json(await createClient(parsed.data));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = ClientBodySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(400).json({ error: msg });
    return;
  }
  try {
    res.json(await updateClient(req.params.id, parsed.data));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteClient(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

export default router;
