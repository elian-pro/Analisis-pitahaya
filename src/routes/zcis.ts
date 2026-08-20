import { Router, Request, Response } from 'express';
import { zcisEnabled, getZcis } from '../config/env';
import { listarClientes, obtenerOferta } from '../zcis/client';
import { limpiarOferta } from '../zcis/limpiar';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Proxy de ZCIS. Existe por una razón concreta: la llave da acceso a la oferta
// de TODOS los clientes, y la oferta es material confidencial (posicionamiento,
// precios, argumentos de venta). Si el navegador llamara a ZCIS directamente,
// la llave quedaría en el código de la página. Aquí no sale del servidor.
//
// Estas rutas van detrás de requireApiAuth, como el resto de /api, y devuelven
// el contenido ya filtrado y ya limpio: el frontend no decide qué se puede
// enseñar, solo lo enseña.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista para el selector. Devuelve `configurado: false` en vez de un error
 * cuando no hay llave: el formulario usa eso para no mostrar la fila de importar
 * y seguir funcionando como un textarea normal.
 */
router.get('/clientes', async (_req: Request, res: Response): Promise<void> => {
  if (!zcisEnabled()) {
    res.json({ configurado: false, clientes: [] });
    return;
  }
  try {
    const todos = await listarClientes(getZcis());
    // Una ficha no vigente quedó desactualizada respecto al brief: importarla
    // metería en los reportes una oferta que el equipo ya sabe que cambió.
    const utiles = todos.filter(c => c.activo && c.tiene_oferta && c.ficha_vigente);
    res.json({
      configurado: true,
      clientes: utiles.map(c => ({ id: c.cliente_id, nombre: c.nombre, vertical: c.vertical })),
      // Cuántas se dejaron fuera, para que "no está mi cliente" tenga respuesta.
      omitidos: todos.length - utiles.length,
    });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

/** La oferta ya limpia de notas internas. Ver zcis/limpiar.ts. */
router.get('/clientes/:id/oferta', async (req: Request, res: Response): Promise<void> => {
  if (!zcisEnabled()) {
    res.status(503).json({ error: 'La integración con ZCIS no está configurada en este servidor.' });
    return;
  }
  try {
    const oferta = await obtenerOferta(getZcis(), req.params.id);
    res.json({
      id:             oferta.cliente_id,
      nombre:         oferta.nombre,
      actualizado_en: oferta.actualizado_en,
      contexto:       limpiarOferta(oferta.contenido),
    });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

export default router;
