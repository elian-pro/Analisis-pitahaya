import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getAdvisors } from '../google/sheets';

const router = Router();

interface ClientConfig {
  id: string;
  spreadsheet_id: string;
  advisors_sheet_name: string;
  col_asesor: string;
  [key: string]: unknown;
}

function loadClients(): ClientConfig[] {
  const p = path.join(__dirname, '..', '..', 'clients.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ClientConfig[];
}

// GET /api/advisors?client_id=xxx
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { client_id } = req.query;

  if (!client_id || typeof client_id !== 'string') {
    res.status(400).json({ error: 'client_id query parameter is required' });
    return;
  }

  let clients: ClientConfig[];
  try {
    clients = loadClients();
  } catch {
    res.status(500).json({ error: 'Failed to load clients.json' });
    return;
  }

  const client = clients.find(c => c.id === client_id);
  if (!client) {
    res.status(404).json({ error: `Client '${client_id}' not found` });
    return;
  }

  if (!client.advisors_sheet_name) {
    res.status(500).json({ error: `Client '${client_id}' has no advisors_sheet_name configured` });
    return;
  }

  try {
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
