import { Router } from 'express';

const router = Router();

// GET /api/advisors?client_id=&spreadsheet_id=&sheet_name=
router.get('/', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 1' });
});

export default router;
