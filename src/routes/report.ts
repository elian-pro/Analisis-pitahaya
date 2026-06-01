import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createJob, getJob } from '../jobs/store';
import { runJob } from '../jobs/runner';

const router = Router();

const PostBodySchema = z.object({
  client_id: z.string().min(1),
  month:     z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  type:      z.enum(['selected', 'general']),
  advisors:  z.array(z.string().min(1)).min(1, 'At least one advisor required'),
});

// POST /api/report — enqueue job, return { job_id }
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = PostBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { client_id, month, type, advisors } = parsed.data;
  const job = createJob(client_id, month, type, advisors);

  // Fire and forget — client polls GET /api/report/:jobId for status
  runJob(job).catch(err =>
    console.error('[report route] runJob threw outside handler:', (err as Error).message),
  );

  res.status(202).json({ job_id: job.id });
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
