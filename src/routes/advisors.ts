import { Router, Request, Response } from 'express';
import { getAdvisorsForMonth, getAdvisors } from '../google/sheets';
import { getClient } from '../clients/manager';

const router = Router();

// GET /api/advisors?client_id=xxx&month=YYYY-MM
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { client_id, month } = req.query;

  if (!client_id || typeof client_id !== 'string') {
    res.status(400).json({ error: 'client_id query parameter is required' });
    return;
  }

  let client;
  try {
    client = await getClient(client_id);
  } catch (e) {
    res.status(500).json({ error: `Failed to load client: ${(e as Error).message}` });
    return;
  }

  if (!client) {
    res.status(404).json({ error: `Client '${client_id}' not found` });
    return;
  }

  try {
    // When month is provided, read directly from the data sheet so advisor
    // names are guaranteed to match the call data (no cross-sheet mismatch).
    if (month && typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) {
      const advisors = await getAdvisorsForMonth(
        client.spreadsheet_id,
        client.data_sheet_name,
        client.col_fecha,
        client.col_asesor,
        month,
      );
      res.json(advisors);
      return;
    }

    // Fallback: no month provided → read from the advisors support sheet
    if (!client.advisors_sheet_name) {
      res.status(500).json({ error: `Client '${client_id}' has no advisors_sheet_name configured` });
      return;
    }
    const advisors = await getAdvisors(
      client.spreadsheet_id,
      client.advisors_sheet_name,
      client.col_asesor,
    );
    res.json(advisors);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[advisors]', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
