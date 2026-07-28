import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { loadClients, getClient, createClient, updateClient, deleteClient } from '../clients/manager';

const router = Router();

const ClientBodySchema = z.object({
  name:                    z.string().min(1),
  // Vacío es válido: la app la crea dentro de parent_folder_id (ver manager.ts).
  folder_id:               z.string().default(''),
  parent_folder_id:        z.string().optional(),
  // Qué carpetas crear en esa ubicación. No se guardan en el cliente: son
  // instrucciones de este guardado, no configuración.
  create_reports_folder:   z.boolean().default(true),
  create_radar_folder:     z.boolean().default(true),
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
  // ── Radar de Objeciones (opcionales) ─────────────────────────────────────────
  prompt_radar:                  z.string().optional(),
  radar_folder_id:               z.string().optional(),
  radar_sidecar_folder_id:       z.string().optional(),
  radar_min_duration_seconds:    z.number().int().min(0).max(3600).optional(),
  radar_transcripcion_max_chars: z.number().int().min(100).max(50000).optional(),
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
  const { create_reports_folder, create_radar_folder, ...data } = parsed.data;
  if (!data.folder_id && !(data.parent_folder_id && create_reports_folder)) {
    res.status(400).json({
      error: 'Falta la carpeta de reportes: elige una ubicación donde crearla o pega el link de una existente.',
    });
    return;
  }
  try {
    res.status(201).json(await createClient(data, {
      reports: create_reports_folder,
      radar:   create_radar_folder,
    }));
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
  // En PUT el schema es parcial: si el formulario no manda las banderas, no se
  // crea nada. Editar un cliente no debe crear carpetas por sorpresa.
  const { create_reports_folder, create_radar_folder, ...patch } = parsed.data;
  try {
    res.json(await updateClient(req.params.id, patch, {
      reports: create_reports_folder ?? false,
      radar:   create_radar_folder   ?? false,
    }));
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
