import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getClient } from '../clients/manager';
import { getAdvisorCallCounts } from '../google/sheets';
import {
  listAdvisors,
  createAdvisor,
  updateAdvisor,
  deleteAdvisor,
  seedAdvisorsFromSheetIfNeeded,
} from '../advisors/store';

const router = Router();

const QuerySchema = z.object({
  client_id:        z.string().min(1),
  month:             z.string().regex(/^\d{4}-\d{2}$/).optional(),
  period_type:       z.enum(['monthly', 'weekly']).optional(),
  date_from:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  include_inactive:  z.coerce.boolean().optional(),
});

// GET /api/advisors?client_id=&month=&period_type=&date_from=&date_to=&include_inactive=
//
// Roster comes from the DB (advisors table), never from Sheets directly — the
// first request for a client with no rows yet triggers a one-time import from
// Sheets (seedAdvisorsFromSheetIfNeeded). When `month` (or a weekly range) is
// given, each advisor also gets `has_calls`: whether Sheets shows at least one
// call for them in that period, so the UI can warn about advisors with none.
// That check is best-effort: if Sheets is unreachable, the roster still comes
// back (has_calls omitted) — a Sheets outage must never hide the DB roster.
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  const { client_id, month, period_type, date_from, date_to, include_inactive } = parsed.data;

  let client;
  try {
    client = await getClient(client_id);
  } catch (e) {
    res.status(500).json({ error: `Failed to load client: ${(e as Error).message}` });
    return;
  }
  if (!client) {
    res.status(404).json({ error: `Client '${client_id}' not found` });
    return;
  }

  await seedAdvisorsFromSheetIfNeeded(client);

  try {
    const advisors = await listAdvisors(client_id, { includeInactive: include_inactive });

    let callCounts: Map<string, number> | null = null;
    if (month) {
      try {
        const dateFrom = period_type === 'weekly' ? date_from : undefined;
        const dateTo   = period_type === 'weekly' ? date_to   : undefined;
        callCounts = await getAdvisorCallCounts(
          client.spreadsheet_id, client.data_sheet_name, client.col_fecha, client.col_asesor,
          month, dateFrom, dateTo,
        );
      } catch (e) {
        console.warn(`[advisors] Could not check call counts for '${client_id}':`, (e as Error).message);
      }
    }

    res.json(advisors.map(a => ({
      ...a,
      // null = no se pudo consultar el Sheet, distinto de 0 = sin llamadas.
      call_count: callCounts ? (callCounts.get(a.name) ?? 0) : null,
      has_calls:  callCounts ? callCounts.has(a.name) : null,
    })));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const CreateBodySchema = z.object({
  client_id: z.string().min(1),
  name:      z.string().min(1),
  initials:  z.string().min(1).max(3).optional(),
  bg:        z.string().optional(),
  color:     z.string().optional(),
});

// POST /api/advisors — add an advisor to a client's roster.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  const { client_id, name, initials, bg, color } = parsed.data;
  try {
    const client = await getClient(client_id);
    if (!client) {
      res.status(404).json({ error: `Client '${client_id}' not found` });
      return;
    }
    // Busca coincidencia por nombre incluyendo los INACTIVOS (borrado suave). Si
    // el nombre ya existe pero está inactivo, se REACTIVA en vez de dar error:
    // así volver a agregar a alguien que se quitó del roster no queda bloqueado
    // por un registro oculto (y no crea duplicados en la base de datos).
    const existing = await listAdvisors(client_id, { includeInactive: true });
    const match = existing.find(a => a.name.toLowerCase() === name.trim().toLowerCase());
    if (match) {
      if (match.active) {
        res.status(409).json({ error: `'${name}' ya existe en el roster de este cliente` });
        return;
      }
      const reactivated = await updateAdvisor(match.id, {
        active: true,
        name:   name.trim(),
        ...(initials ? { initials: initials.trim().toUpperCase() } : {}),
        ...(bg    ? { bg }    : {}),
        ...(color ? { color } : {}),
      });
      res.status(200).json(reactivated);
      return;
    }
    const advisor = await createAdvisor(client_id, { name, initials, bg, color });
    res.status(201).json(advisor);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const UpdateBodySchema = z.object({
  name:     z.string().min(1).optional(),
  initials: z.string().min(1).max(3).optional(),
  bg:       z.string().optional(),
  color:    z.string().optional(),
  active:   z.boolean().optional(),
});

// PATCH /api/advisors/:id — rename, recolor, or activate/deactivate.
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try {
    const advisor = await updateAdvisor(req.params.id, parsed.data);
    res.json(advisor);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

// DELETE /api/advisors/:id — hard delete (the UI normally deactivates
// instead, see PATCH; this stays available for correcting mistakes, e.g. a
// duplicate entry, consistent with the other CRUD routers in this project).
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteAdvisor(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

export default router;
