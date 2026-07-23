import { Router, Request, Response } from 'express';
import { listSheetTabs, getSheetHeaders } from '../google/sheets';
import { extractSpreadsheetId } from '../google/urls';

const router = Router();

// Con OAuth de la cuenta central, el acceso ya no depende de compartir la hoja
// con la service account: la hoja debe pertenecer (o estar compartida con) la
// cuenta de Google conectada al hacer `npm run oauth:setup`.
const ACCESS_HINT = 'Verifica el link y que la hoja pertenezca o esté compartida con la cuenta de Google conectada.';

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
    const permissionish = /permission|not found|403|404|does not have|unable to parse|requested entity/i.test(msg);
    res.status(400).json({
      error: permissionish
        ? `No se pudo abrir la hoja. ${ACCESS_HINT}`
        : `No se pudieron leer las pestañas: ${msg}`,
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
    const permissionish = /permission|not found|403|404|does not have|unable to parse|requested entity|range/i.test(msg);
    res.status(400).json({
      error: permissionish
        ? `No se pudieron leer las columnas de “${tab}”. ${ACCESS_HINT}`
        : `No se pudieron leer las columnas: ${msg}`,
    });
  }
});

export default router;
