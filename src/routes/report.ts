import { Router } from 'express';

const router = Router();

// POST /api/report — enqueue job, return { job_id }
router.post('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 6' });
});

// GET /api/report/:jobId — poll job status
router.get('/:jobId', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 6' });
});

export default router;
