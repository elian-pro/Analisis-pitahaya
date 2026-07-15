import { Router, Request, Response } from 'express';
import { listSheetTabs, getSheetHeaders } from '../google/sheets';
import { extractSpreadsheetId } from '../google/urls';
import { getGoogleServiceAccount } from '../config/env';

const router = Router();

function serviceAccountEmail(): string {
  try {
    return (getGoogleServiceAccount() as { client_email?: string }).client_email || 'la cuenta de servicio';
  } catch {
    return 'la cuenta de servicio';
  }
}

// GET /api/sheets/tabs?spreadsheet=<link o ID>
// Devuelve las pestañas (hojas) del spreadsheet para elegir en un menú.
router.get('/tabs', async (req: Request, res: Response): Promise<void> => {
  const raw = String(req.query.spreadsheet ?? '').trim();
  const spreadsheetId = extractSpreadsheetId(raw);
  if (!spreadsheetId) {
    res.status(400).json({ error: 'Pega el link (o el ID) de la hoja de Google.' });
    return;
  }
  try {
    const { title, tabs } = await listSheetTabs(spreadsheetId);
    res.json({ spreadsheet_id: spreadsheetId, title, tabs });
  } catch (e) {
    const msg = (e as Error).message || '';
    const saEmail = serviceAccountEmail();
    const permissionish = /permission|not found|403|404|does not have|unable to parse|requested entity/i.test(msg);
    res.status(400).json({
      error: permissionish
        ? `No se pudo abrir la hoja. Verifica el link y compártela (como Lector) con ${saEmail}.`
        : `No se pudieron leer las pestañas: ${msg}`,
      sa_email: saEmail,
    });
  }
});

// GET /api/sheets/headers?spreadsheet=<link o ID>&tab=<nombre de la pestaña>
// Devuelve los encabezados (fila 1) de la pestaña, para elegir las columnas.
router.get('/headers', async (req: Request, res: Response): Promise<void> => {
  const spreadsheetId = extractSpreadsheetId(String(req.query.spreadsheet ?? '').trim());
  const tab = String(req.query.tab ?? '').trim();
  if (!spreadsheetId) { res.status(400).json({ error: 'Pega el link (o el ID) de la hoja de Google.' }); return; }
  if (!tab) { res.status(400).json({ error: 'Falta el nombre de la pestaña.' }); return; }
  try {
    const headers = await getSheetHeaders(spreadsheetId, tab);
    res.json({ spreadsheet_id: spreadsheetId, tab, headers });
  } catch (e) {
    const msg = (e as Error).message || '';
    const saEmail = serviceAccountEmail();
    const permissionish = /permission|not found|403|404|does not have|unable to parse|requested entity|range/i.test(msg);
    res.status(400).json({
      error: permissionish
        ? `No se pudieron leer las columnas de “${tab}”. Verifica el link y que la hoja esté compartida con ${saEmail}.`
        : `No se pudieron leer las columnas: ${msg}`,
      sa_email: saEmail,
    });
  }
});

export default router;
