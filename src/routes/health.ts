import { Router } from 'express';
import { callsDbInfo } from '../calls/db';
import { sweeperCorriendo } from '../calls/sweeper';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Healthcheck de Docker, y la única ruta pública de /api.
//
// Por eso reporta también qué hay desplegado y desde cuándo: durante una puesta
// en marcha, "¿el servidor tiene ya mi último cambio?" y "¿se reinició después
// de que tocara las variables?" son las dos primeras preguntas, y responderlas
// exigía entrar con sesión justo cuando la app podía estar caída.
//
// No expone nada sensible: ni host, ni usuario, ni credenciales. Solo si las
// piezas están presentes y cuándo arrancó el proceso.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const calls = callsDbInfo();
  res.json({
    status: 'ok',
    ts:     new Date().toISOString(),
    build:  'combined-pdf-v2',
    // `features` es lo que distingue una versión de otra sin necesidad de un
    // número de build: si esta clave no viene en la respuesta, lo desplegado es
    // anterior al pipeline de llamadas.
    features: ['calls-pipeline', 'calls-diagnostico', 'zcis-oferta', 'analisis-automatico'],
    proceso: {
      arrancadoEn: calls.arrancadoEn,
      uptimeMin:   calls.uptimeMin,
    },
    calls: {
      // Antes esto reportaba una variable de entorno; ahora reporta el hecho:
      // si el tick está vivo en este proceso. Qué orígenes procesa lo decide su
      // interruptor de Ajustes, y eso se ve en la propia pantalla.
      barrido:    sweeperCorriendo() ? 'activo' : 'parado',
      dbUrl:      calls.configurada,
      geminiKey:  Boolean(process.env.GEMINI_API_KEY),
      openaiKey:  Boolean(process.env.OPENAI_API_KEY),
    },
    // Si la fila de "Traer oferta" no aparece, esto responde por qué sin
    // necesidad de entrar con sesión. Booleano: la llave nunca sale de aquí.
    zcis: { configurado: Boolean(process.env.ZCIS_API_KEY) },
  });
});

export default router;
