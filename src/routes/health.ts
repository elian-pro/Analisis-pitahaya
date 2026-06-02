import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), build: 'combined-pdf-v2' });
});

export default router;
