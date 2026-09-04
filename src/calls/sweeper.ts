import { loadClients } from '../clients/manager';
import { listCuentasHabilitadas, logCuentas } from './registry';
import { listPendientes } from './store';
import { getConfig, ensureConfigTable, debeBarrer } from './config';
import { cuentasTenant, configDeTenant } from './tenant';
import { callsDbEnabled } from './db';
import { processCall, matchClient, minDuracion } from './pipeline';

// ─────────────────────────────────────────────────────────────────────────────
// El motor del pipeline.
//
// Nadie nos avisa cuando entra una llamada: Callpicker escribe directo en
// `llamadas` y no le pedimos que cambie. Así que el pipeline pregunta cada
// minuto qué falta por hacer. Eso mismo cubre los reinicios a medio proceso y
// las caídas puntuales de Gemini o del modelo, sin lógica aparte.
//
// Sigue la forma de startScheduler() (schedules/runner.ts:470-498): idempotente,
// tick de 60 s y una pasada inmediata al arrancar.
// ─────────────────────────────────────────────────────────────────────────────

/** Tope por vuelta. Sin él, un backlog dispararía Gemini sin freno. */
export const LOTE = 5;
export const MAX_INTENTOS = 3;
const INTERVALO_MS = 60_000;

/**
 * Respaldo cuando una cuenta no tiene fecha configurada. Lo normal es que la
 * tenga: se elige al activarla, y va en zebra_calls_config por cuenta y no aquí,
 * porque cada cliente decide cuánto histórico quiere pagar. El histórico entero
 * de Sofía son 275 h de audio, y eso no se lanza por defecto.
 */
export const DESDE = process.env.CALLS_DESDE || '2026-08-01';

let _interval: NodeJS.Timeout | null = null;
let _corriendo = false;

export interface SweepResult {
  procesadas: number;
  fallidas:   number;
  /** Orígenes saltados por tener el interruptor de Ajustes apagado. */
  pausados:   string[];
}

const NADA = (): SweepResult => ({ procesadas: 0, fallidas: 0, pausados: [] });

export async function sweepOnce(lote = LOTE): Promise<SweepResult> {
  // El solapamiento importa más que en el scheduler: dos barridos a la vez
  // transcribirían la misma llamada dos veces y se pagaría dos veces.
  if (_corriendo) return NADA();
  _corriendo = true;
  try {
    // Dos poblaciones: las cuentas de Callpicker (si esa base está configurada)
    // y las bases propias de clientes externos. El pipeline es el mismo.
    const cuentas = [
      ...(callsDbEnabled() ? await listCuentasHabilitadas() : []),
      ...await cuentasTenant(),
    ];
    if (cuentas.length === 0) return NADA();

    const clients = await loadClients();
    let procesadas = 0, fallidas = 0;
    const pausados: string[] = [];

    for (const cuenta of cuentas) {
      if (procesadas >= lote) break;
      // Una base tenant caída no puede frenar el barrido de las demás cuentas.
      try {
        const cfg = cuenta.tenant ? await configDeTenant(cuenta) : await getConfig(cuenta.esquema);
        // El interruptor de Ajustes. Va aquí y no en listCuentasHabilitadas para
        // que "Reprocesar pendientes" —que llama a este mismo sweepOnce— lo
        // respete gratis. Procesar UNA llamada a mano desde su fila no pasa por
        // aquí, y así debe ser: es un acto humano explícito.
        if (!debeBarrer(cfg)) { pausados.push(cuenta.slug); continue; }
        const pendientes = await listPendientes(cuenta, {
          minDuracion: minDuracion(matchClient(cuenta, clients)),
          desde:       cfg?.desde ?? DESDE,
          maxIntentos: MAX_INTENTOS,
          limit:       lote - procesadas,
        });

        // En serie a propósito: son reintentos de algo que suele haber fallado
        // porque el proveedor estaba saturado, y golpearlo en paralelo lo empeora.
        for (const call of pendientes) {
          const r = await processCall(cuenta.slug, call.call_id);
          procesadas++;
          if (!r.ok) fallidas++;
        }
      } catch (e) {
        console.warn(`[calls/sweep] ${cuenta.slug}: ${(e as Error).message}`);
      }
    }

    if (procesadas > 0) {
      console.log(`[calls/sweep] ${procesadas} procesada(s), ${fallidas} fallida(s)`);
    }
    return { procesadas, fallidas, pausados };
  } catch (e) {
    // Un fallo del barrido no puede tumbar el tick: la próxima vuelta reintenta.
    console.warn('[calls/sweep] error:', (e as Error).message);
    return NADA();
  } finally {
    _corriendo = false;
  }
}

/** Si el tick está vivo en ESTE proceso. Lo publica /api/health. */
export const sweeperCorriendo = (): boolean => _interval !== null;

export function startCallsSweeper(): void {
  if (_interval) return;
  // Freno de mano SOLO para desarrollo. El interruptor de verdad está en
  // Ajustes, pero vive en la base compartida: sin esto, un `npm run dev` en un
  // portátil con las llaves reales se pondría a transcribir llamadas de
  // producción, y apagarlo desde la UI lo apagaría también para todos.
  // Al revés que la variable que sustituye: aquí el valor por defecto es
  // ENCENDIDO, y /api/health dice cuál de los dos está pasando.
  if (process.env.CALLS_SWEEP === 'off') {
    console.log('[calls/sweep] barrido apagado por CALLS_SWEEP=off (solo desarrollo)');
    return;
  }
  _interval = setInterval(() => { void sweepOnce(); }, INTERVALO_MS);
  // La primera pasada espera a que la tabla de configuración esté al día. Antes
  // no esperaba, y ahora sí importa: sin la columna `auto`, getConfig no puede
  // leer el interruptor y el arranque se saltaría todos los orígenes hasta el
  // segundo tick.
  void (callsDbEnabled() ? ensureConfigTable() : Promise.resolve())
    .catch(e => console.warn('[calls] config:', e.message))
    .then(() => { if (callsDbEnabled()) void logCuentas(); return sweepOnce(); });
  console.log(`[calls/sweep] barrido activo (cada 60 s, desde ${DESDE})`);
}

export function stopCallsSweeper(): void {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
