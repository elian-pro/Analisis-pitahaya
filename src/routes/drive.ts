import { Router, Request, Response } from 'express';
import { describeFolder, listFolders, listSharedDrives } from '../google/drive';

const router = Router();

// GET /api/drive/folders            → Unidades Compartidas (raíz del selector)
// GET /api/drive/folders?parent=ID  → subcarpetas de esa carpeta
// Lee con el OAuth de la cuenta central: solo aparece lo que esa cuenta ve.
router.get('/folders', async (req: Request, res: Response): Promise<void> => {
  const parent = String(req.query.parent ?? '').trim();
  try {
    res.json({ items: parent ? await listFolders(parent) : await listSharedDrives() });
  } catch (e) {
    const msg = (e as Error).message || '';
    const permissionish = /permission|not found|403|404|does not have/i.test(msg);
    res.status(400).json({
      error: permissionish
        ? 'No se pudo leer esa carpeta. Verifica que la cuenta de Google conectada sea miembro de la Unidad Compartida.'
        : `No se pudieron leer las carpetas: ${msg}`,
    });
  }
});

// GET /api/drive/names?ids=a,b,c
// Traduce IDs de carpeta a { name, path } para que la UI muestre nombres en vez
// de IDs. Los que no se puedan resolver simplemente no vienen en la respuesta.
router.get('/names', async (req: Request, res: Response): Promise<void> => {
  const ids = String(req.query.ids ?? '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
  const out: Record<string, { name: string; path: string; parentId: string }> = {};
  await Promise.all(ids.map(async id => {
    const info = await describeFolder(id);
    if (info) out[id] = { name: info.name, path: info.path, parentId: info.parentId };
  }));
  res.json(out);
});

export default router;
