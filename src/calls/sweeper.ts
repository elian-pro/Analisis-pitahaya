import { listPendientes } from './store';
import { processCall } from './pipeline';

// ─────────────────────────────────────────────────────────────────────────────
// Barrido de llamadas a medias.
//
// Recoge lo que quedó en 'recibida', 'transcrita' o 'fallida' y lo reintenta.
// Cubre tres agujeros que hoy no tienen red:
//   • un reinicio a mitad de una transcripción,
//   • una caída puntual de Gemini o de OpenAI,
//   • una llamada que llegó sin cliente y alguien acaba de asignar.
//
// Copia la forma de startScheduler() (schedules/runner.ts:470-498): idempotente,
// un tick de 60 s, y una comprobación inmediata al arrancar por si el despliegue
// se comió el minuto. Con un Set no hace falta: aquí basta un booleano porque el
// barrido es uno solo, no uno por automatización.
// ─────────────────────────────────────────────────────────────────────────────

/** Tope por vuelta. Sin él, un backlog de miles dispararía Gemini sin freno. */
export const LOTE = 5;
export const MAX_INTENTOS = 3;
const INTERVALO_MS = 60_000;

let _interval: NodeJS.Timeout | null = null;
let _corriendo = false;

export async function sweepOnce(lote = LOTE): Promise<{ procesadas: number; fallidas: number }> {
  // El solapamiento importa más que en el scheduler: dos barridos a la vez
  // transcribirían la misma llamada dos veces y se pagaría dos veces.
  if (_corriendo) return { procesadas: 0, fallidas: 0 };
  _corriendo = true;
  try {
    const pendientes = await listPendientes(MAX_INTENTOS, lote);
    if (pendientes.length === 0) return { procesadas: 0, fallidas: 0 };

    let fallidas = 0;
    // En serie a propósito: son reintentos de algo que ya falló, y normalmente
    // falló porque el proveedor estaba saturado. Golpearlo en paralelo lo empeora.
    for (const call of pendientes) {
      const r = await processCall(call.call_id);
      if (!r.ok) fallidas++;
    }
    console.log(`[calls/sweep] ${pendientes.length} procesada(s), ${fallidas} fallida(s)`);
    return { procesadas: pendientes.length, fallidas };
  } catch (e) {
    // Un fallo del barrido no puede tumbar el tick: la próxima vuelta reintenta.
    console.warn('[calls/sweep] error:', (e as Error).message);
    return { procesadas: 0, fallidas: 0 };
  } finally {
    _corriendo = false;
  }
}

export function startCallsSweeper(): void {
  if (_interval) return;
  _interval = setInterval(() => { void sweepOnce(); }, INTERVALO_MS);
  void sweepOnce();
  console.log('[calls/sweep] barrido activo (cada 60 s)');
}

export function stopCallsSweeper(): void {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
