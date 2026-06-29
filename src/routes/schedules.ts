import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { listSchedules, createSchedule, updateSchedule, deleteSchedule } from '../schedules/store';

const router = Router();

const ScheduleBaseSchema = z.object({
  name:            z.string().min(1),
  client_id:       z.string().min(1),
  enabled:         z.boolean().default(true),
  frequency:       z.enum(['weekly', 'monthly', 'once']),
  day_of_week:     z.number().int().min(0).max(6).optional(),
  day_of_month:    z.number().int().min(1).max(28).optional(),
  run_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
