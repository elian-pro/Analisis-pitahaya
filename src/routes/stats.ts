import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryStats } from '../tokens/store';

const router = Router();

const QuerySchema = z.object({
  from:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  client_id: z.string().optional(),
});

router.get('/', (req: Request, res: Response): void => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });
    return;
  }
  const { from, to, client_id } = parsed.data;
  res.json(queryStats(from, to, client_id));
});

export default router;
