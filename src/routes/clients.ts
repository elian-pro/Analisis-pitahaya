import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { loadClients, getClient, createClient, updateClient, deleteClient, clientFileLabel } from '../clients/manager';

const router = Router();

const ClientBodySchema = z.object({
  name:                    z.string().min(1),
  // Nombre corto para Drive. Vacío => se usa `name`.
  short_name:              z.string().optional(),
  // Vacío es válido: la app la crea dentro de parent_folder_id (ver manager.ts).
  folder_id:               z.string().default(''),
  parent_folder_id:        z.string().optional(),
  // Qué carpetas crear en esa ubicación. No se guardan en el cliente: son
  // instrucciones de este guardado, no configuración.
  create_reports_folder:   z.boolean().default(true),
  create_radar_folder:     z.boolean().default(true),
  sidecar_folder_id:       z.string().optional(),
  spreadsheet_id:          z.string().default(''),
  data_sheet_name:         z.string().default(''),
  col_fecha:               z.string().default(''),
  col_asesor:              z.string().default(''),
  col_calif:               z.string().default(''),
  col_analisis:            z.string().default(''),
  col_transcripcion:       z.string().default(''),
  col_duracion:            z.string().optional(),
  col_record:              z.string().optional(),
  excluded_phrases:        z.array(z.string()).default([]),
  transcripcion_max_chars: z.number().int().min(100).default(3000),
  prompt_individual:       z.string().optional(),
  prompt_general:          z.string().optional(),
  // ── Radar de Objeciones (opcionales) ─────────────────────────────────────────
  prompt_radar:                  z.string().optional(),
  radar_folder_id:               z.string().optional(),
  radar_sidecar_folder_id:       z.string().optional(),
  radar_min_duration_seconds:    z.number().int().min(0).max(3600).optional(),
  radar_transcripcion_max_chars: z.number().int().min(100).max(50000).optional(),
  // ── Fuente de las llamadas y pipeline (opcionales; ver ClientConfig) ─────────
  calls_source:                  z.enum(['sheets','postgres']).optional(),
  calls_schema:                  z.string().optional(),
  contexto_negocio:              z.string().optional(),
  prompt_transcripcion:          z.string().optional(),
  prompt_analisis:               z.string().optional(),
  call_min_duration_seconds:     z.number().int().min(0).max(3600).optional(),
})
// Los campos de Sheets dejaron de ser obligatorios para que un cliente de
// Postgres pueda existir sin hoja. Eso abre la puerta a guardar uno sin ninguna
// fuente, asi que la exigencia pasa a depender de cual se eligio.
.superRefine((d, ctx) => {
  const fuente = d.calls_source ?? 'sheets';
  if (fuente === 'postgres') {
    if (!d.calls_schema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['calls_schema'],
        message: 'Con fuente Postgres hay que elegir el schema de llamadas.' });
    }
    return;
  }
  for (const [campo, etiqueta] of [
    ['spreadsheet_id','la hoja de calculo'], ['data_sheet_name','la pestaña de datos'],
    ['col_fecha','la columna de fecha'],     ['col_asesor','la columna de asesor'],
    ['col_calif','la columna de calificacion'], ['col_analisis','la columna de analisis'],
    ['col_transcripcion','la columna de transcripcion'],
  ] as const) {
    if (!d[campo]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo],
        message: `Con fuente Google Sheets hace falta ${etiqueta}.` });
    }
  }
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
  // .partial() no esta en un schema con superRefine: se usa el objeto de dentro,
  // que ademas es lo correcto para un PATCH (validar solo lo que llega).
  const parsed = ClientBodySchema.innerType().partial().safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(400).json({ error: msg });
    return;
  }
  // En PUT el schema es parcial: si el formulario no manda las banderas, no se
  // crea nada. Editar un cliente no debe crear carpetas por sorpresa.
  const { create_reports_folder, create_radar_folder, ...patch } = parsed.data;
  try {
    const before  = await getClient(req.params.id);
    const updated = await updateClient(req.params.id, patch, {
      reports: create_reports_folder ?? false,
      radar:   create_radar_folder   ?? false,
    });
    res.json(updated);

    // Cambió el nombre con el que este cliente aparece en Drive: se arrastra a
    // sus carpetas y a los PDFs ya generados. Va DESPUÉS de responder y sin
    // await: un cliente con historial puede tener cientos de archivos y el
    // formulario no debe quedarse esperando. Los reportes se entregan por ID de
    // carpeta, así que si esto falla el daño es solo cosmético.
    const antes  = before ? clientFileLabel(before) : '';
    const ahora  = clientFileLabel(updated);
    if (antes && ahora && antes !== ahora) {
      void (async () => {
        const { renameClientArtifacts } = await import('../google/drive');
        const n = await renameClientArtifacts(
          [updated.folder_id, updated.radar_folder_id ?? ''], antes, ahora,
        );
        console.log(`[clients] '${updated.id}': ${n} elemento(s) renombrados de "${antes}" a "${ahora}".`);
      })().catch(e => console.warn('[clients] Renombrado en Drive fallido:', (e as Error).message));
    }
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
