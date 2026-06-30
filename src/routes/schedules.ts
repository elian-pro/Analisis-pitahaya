import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from '../schedules/store';
import { runScheduleNow } from '../schedules/runner';

const router = Router();

const ScheduleBaseSchema = z.object({
  name:            z.string().min(1),
  client_id:       z.string().min(1),
  enabled:         z.boolean().default(true),
  frequency:       z.enum(['weekly', 'monthly', 'once']),
  day_of_week:     z.number().int().min(0).max(6).optional(),
  day_of_month:    z.number().int().min(1).max(28).optional(),
  run_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  once_mode:       z.enum(['weekly', 'monthly']).optional(),
  once_month:      z.string().regex(/^\d{4}-\d{2}$/).optional(),
  once_date_from:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  once_date_to:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour:            z.number().int().min(0).max(23),
  minute:          z.number().int().min(0).max(59).default(0),
  timezone:        z.string().default('America/Mexico_City'),
  report_type:     z.enum(['selected', 'general']),
  include_general: z.boolean().default(true),
  advisors:        z.union([z.literal('all'), z.array(z.string().min(1))]).default('all'),
  notify_only:     z.boolean().default(false),
  chat_space_id:   z.string().optional(),
  chat_message:    z.string().optional(),
  error_notify_enabled: z.boolean().default(false),
  error_chat_space_id:  z.string().optional(),
});

const ScheduleBodySchema = ScheduleBaseSchema.refine(
  d => d.frequency !== 'weekly'  || d.day_of_week  !== undefined,
  { message: 'day_of_week required for weekly frequency' },
).refine(
  d => d.frequency !== 'monthly' || d.day_of_month !== undefined,
  { message: 'day_of_month required for monthly frequency' },
).refine(
  d => d.frequency !== 'once'    || d.run_date     !== undefined,
  { message: 'run_date required for once frequency' },
).refine(
  d => d.frequency !== 'once'    || d.once_mode    !== undefined,
  { message: 'once_mode required for once frequency' },
).refine(
  d => d.frequency !== 'once' || d.once_mode !== 'weekly' || (!!d.once_date_from && !!d.once_date_to),
  { message: 'once_date_from and once_date_to required for a one-time weekly report' },
).refine(
  d => d.frequency !== 'once' || d.once_mode !== 'monthly' || !!d.once_month,
  { message: 'once_month required for a one-time monthly report' },
);

const SchedulePatchSchema = ScheduleBaseSchema.partial();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try { res.json(await listSchedules()); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = ScheduleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try { res.status(201).json(await createSchedule(parsed.data)); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = SchedulePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i: z.ZodIssue) => i.message).join('; ') });
    return;
  }
  try { res.json(await updateSchedule(req.params.id, parsed.data)); }
  catch (e) { res.status(404).json({ error: (e as Error).message }); }
});

// POST /:id/run — manually fire a schedule now (bypasses time/day gating).
// Works even when the schedule is paused. Returns 202 once the report job has
// been enqueued; immediate failures (sheet read, no advisors) return 422.
router.post('/:id/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await runScheduleNow(req.params.id);
    if (!result.ok) {
      res.status(422).json({ ok: false, error: result.error || 'La ejecución falló.' });
      return;
    }
    res.status(202).json({ ok: true, job_id: result.job_id });
  } catch (e) {
    const msg = (e as Error).message;
    res.status(/not found/i.test(msg) ? 404 : 500).json({ ok: false, error: msg });
  }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try { await deleteSchedule(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ error: (e as Error).message }); }
});

export default router;
