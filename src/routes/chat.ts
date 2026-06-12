import { Router, Request, Response } from 'express';
import { listSpaces } from '../google/chat';

const router = Router();

router.get('/spaces', async (_req: Request, res: Response): Promise<void> => {
  try {
    const spaces = await listSpaces();
    res.json(spaces);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
