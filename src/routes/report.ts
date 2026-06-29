import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getClient } from '../clients/manager';
import { createJob, getJob, updateJob } from '../jobs/store';
import { runJob } from '../jobs/runner';
import { findSidecarFolder, findPreviousPeriodKey, monthLabel } from '../google/drive';
import { previousPeriodKeyFromDb } from '../metrics/store';

const router = Router();

// Human-friendly label for a sidecar period key: 'YYYY-MM' → "Junio 2026",
// 'YYYY-MM-DD' → "Semana del 15/06".
function periodKeyLabel(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) return monthLabel(key);
  const [, m, d] = key.split('-');
  return `Semana del ${d}/${m}`;
}

const PostBodySchema = z.object({
  client_id:   z.string().min(1),
  month:       z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  type:        z.enum(['selected', 'general']),
  advisors:    z.array(z.string().min(1)).min(1, 'At least one advisor required'),
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  data => data.period_type !== 'weekly' || (!!data.date_from && !!data.date_to),
  { message: 'date_from and date_to are required when period_type is weekly' },
);

// POST /api/report — enqueue job, return { job_id }
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = PostBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map(i => `${i.path.length ? i.path.join('.') : 'body'}: ${i.message}`)
      .join('; ');
    console.error('[report POST] validation error:', msg, '| body:', JSON.stringify(req.body));
    res.status(400).json({ error: msg });
    return;
  }

  const { client_id, month, type, advisors, period_type, date_from, date_to } = parsed.data;
  const job = createJob(client_id, month, type, advisors, period_type, date_from, date_to);

  runJob(job).catch(err =>
    console.error('[report route] runJob threw outside handler:', (err as Error).message),
  );

  res.status(202).json({ job_id: job.id });
});

// POST /api/report/:jobId/cancel — request cancellation of a running job
router.post('/:jobId/cancel', (req: Request, res: Response): void => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `Job '${req.params.jobId}' not found` });
    return;
  }
  if (job.status !== 'running' && job.status !== 'pending') {
    res.status(409).json({ error: `Job cannot be cancelled (status: ${job.status})` });
    return;
  }
  updateJob(job.id, { status: 'cancelled' });
  console.log(`[report route] Job ${job.id} cancelled by user`);
  res.json({ ok: true });
});

// GET /api/report/previous — does a prior-period report exist to compare against?
// Used by the confirmation modal to surface a "se detectó reporte anterior" hint.
// Registered before '/:jobId' so the literal path isn't captured as a job id.
const PreviousQuerySchema = z.object({
  client_id:   z.string().min(1),
  month:       z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  period_type: z.enum(['monthly', 'weekly']).default('monthly'),
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  advisors:    z.union([z.string(), z.array(z.string())]).transform(
    v => (Array.isArray(v) ? v : [v]).filter(Boolean),
  ),
});

router.get('/previous', async (req: Request, res: Response): Promise<void> => {
  const parsed = PreviousQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  const { client_id, month, period_type, date_from, advisors } = parsed.data;
  if (advisors.length === 0) {
    res.json({ has_previous: false });
    return;
  }

  let client: Awaited<ReturnType<typeof getClient>>;
  try {
    client = await getClient(client_id);
  } catch {
    res.status(500).json({ error: 'Failed to load clients configuration' });
    return;
  }
  if (!client) {
    res.status(404).json({ error: `Client '${client_id}' not found` });
    return;
  }

  try {
    // Database first: a single indexed query, no Drive calls needed when it hits.
    let prevKey = await previousPeriodKeyFromDb(client_id, advisors, month, period_type, date_from);

    // Fallback to Drive sidecars when the DB has nothing (e.g. periods generated
    // before report_metrics existed). Read-only: never create a _Sidecars folder
    // from a GET — a missing folder just means "first period".
    if (!prevKey) {
      const sidecarFolderId = client.sidecar_folder_id
        ?? await findSidecarFolder(client.folder_id);
      if (sidecarFolderId) {
        prevKey = await findPreviousPeriodKey(sidecarFolderId, advisors, month, period_type, date_from);
      }
    }

    if (!prevKey) {
      res.json({ has_previous: false });
      return;
    }
    res.json({ has_previous: true, period_key: prevKey, period_label: periodKeyLabel(prevKey) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[report previous]', msg);
    // Treat lookup failure as "unknown" rather than an error — the hint is purely
    // informational and must never block report generation. `reason` is surfaced to
    // the client only to aid debugging from the browser console.
    res.json({ has_previous: false, unknown: true, reason: msg });
  }
});

// GET /api/report/:jobId — poll job status
router.get('/:jobId', (req: Request, res: Response): void => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `Job '${req.params.jobId}' not found` });
    return;
  }
  res.json(job);
});

export default router;
