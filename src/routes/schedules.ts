import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from '../schedules/store';

const router = Router();

const ScheduleBaseSchema = z.object({
  name:            z.string().min(1),
  client_id:       z.string().min(1),
  enabled:         z.boolean().default(true),
  frequency:       z.enum(['weekly', 'monthly']),
  day_of_week:     z.number().int().min(0).max(6).optional(),
  day_of_month:    z.number().int().min(1).max(28).optional(),
  hour:            z.number().int().min(0).max(23),
  minute:          z.number().int().min(0).max(59).default(0),
  timezone:        z.string().default('America/Mexico_City'),
  report_type:     z.enum(['selected', 'general']),
  include_general: z.boolean().default(true),
  advisors:        z.union([z.literal('all'), z.array(z.string().min(1))]).default('all'),
});

const ScheduleBodySchema = ScheduleBaseSchema.refine(
  d => d.frequency !== 'weekly'  || d.day_of_week  !== undefined,
  { message: 'day_of_week required for weekly frequency' },
).refine(
  d => d.frequency !== 'monthly' || d.day_of_month !== undefined,
  { message: 'day_of_month required for monthly frequency' },
);

const SchedulePatchSchema = ScheduleBaseSchema.partial();

router.get('/', (_req: Request, res: Response): void => {
  res.json(listSchedules());
});

router.post('/', (req: Request, res: Response): void => {
  const parsed = ScheduleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  try { res.status(201).json(createSchedule(parsed.data)); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

router.put('/:id', (req: Request, res: Response): void => {
  const parsed = SchedulePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i: z.ZodIssue) => i.message).join('; ') });
    return;
  }
  try { res.json(updateSchedule(req.params.id, parsed.data)); }
  catch (e) { res.status(404).json({ error: (e as Error).message }); }
});

router.delete('/:id', (req: Request, res: Response): void => {
  try { deleteSchedule(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ error: (e as Error).message }); }
});

export default router;
