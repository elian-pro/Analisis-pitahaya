import { getGeminiKey, getOpenAIKey } from '../config/env';
import { loadClients, type ClientConfig } from '../clients/manager';
import { resolveTranscriptionPrompt, resolveAnalysisPrompt } from './prompts';
import { transcribeAudio, GEMINI_MODEL } from './transcribe';
import { analyzeTranscript, ANALYSIS_MODEL } from './analyze';
import { getCuenta, type Cuenta } from './registry';
import { getConfig } from './config';
import { configDeTenant } from './tenant';
import { recordTokens } from '../tokens/store';
import {
  getCall, markTranscrita, markAnalizada, markBuzon, markFallida, type CallRow,
} from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Procesamiento de una llamada: transcribir, clasificar, guardar.
//
// Cada paso persiste antes de arrancar el siguiente. Si falla la transcripción
// la llamada sigue en `llamadas` y el barrido la recoge; si falla el análisis la
// transcripción ya está guardada y no se vuelve a pagar. En n8n no se escribía
// nada hasta terminar todo, así que un fallo a mitad perdía la llamada entera.
//
// Único módulo del directorio que toca credenciales y las dos bases a la vez:
// los prompts vienen de la base de Zebra Reports y las llamadas de la otra. Como
// no se pueden cruzar en SQL, el cruce se hace aquí, en memoria.
// ─────────────────────────────────────────────────────────────────────────────

export type ProcessOutcome =
  | { ok: true;  estado: 'analizada'; buzon: boolean }
  | { ok: false; error: string };

/**
 * El cliente de Zebra Reports que corresponde a una cuenta de Callpicker. Se
 * empareja por slug o por nombre porque son dos catálogos distintos, en bases
 * distintas, mantenidos por manos distintas: 'midstorage' contra "Midstorage".
 */
export function matchClient(cuenta: Cuenta, clients: ClientConfig[]): ClientConfig | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const slug = norm(cuenta.slug), nombre = norm(cuenta.cliente);
  return clients.find(c => norm(c.id) === slug || norm(c.name) === nombre)
      ?? clients.find(c => norm(c.id) === nombre || norm(c.name) === slug);
}

export async function processCall(
  slug:   string,
  callId: string,
  force = false,
): Promise<ProcessOutcome> {
  const cuenta = await getCuenta(slug);
  if (!cuenta) return { ok: false, error: `No existe la cuenta '${slug}' en callpicker_registro` };
  if (!cuenta.habilitada) {
    return { ok: false, error: `'${slug}' no tiene tabla analisis en su schema` };
  }

  const row = await getCall(cuenta, callId);
  if (!row) return { ok: false, error: `No existe la llamada ${callId} en ${cuenta.esquema}` };
  if (!row.record) return { ok: false, error: 'La llamada no tiene grabación' };
  if (row.estado === 'analizada' && !force) {
    return { ok: true, estado: 'analizada', buzon: row.analisis === 'Buzón de voz' };
  }

  // Los prompts viven en la base de Zebra Reports; el contexto del negocio va por
  // CUENTA y no por cliente, porque dos clientes pueden compartir una y el audio
  // se transcribe una sola vez para ambos.
  const client = matchClient(cuenta, await loadClients());
  const cfgCuenta = cuenta.tenant ? await configDeTenant(cuenta) : await getConfig(cuenta.esquema);
  const contexto = cfgCuenta?.contexto_negocio ?? client?.contexto_negocio;

  // Telemetría de consumo por proveedor. void + catch propio: registrar tokens
  // jamás puede tumbar el procesamiento de una llamada.
  const cobrar = (model: string, usage?: { input: number; output: number }) => {
    if (!usage) return;
    void recordTokens({ client_id: client?.id ?? cuenta.slug, model, input: usage.input, output: usage.output })
      .catch(() => {});
  };

  try {
    let transcripcion = force ? null : row.transcripcion;

    if (!transcripcion) {
      const t = await transcribeAudio(
        row.record,
        resolveTranscriptionPrompt(client?.prompt_transcripcion, contexto ?? undefined),
        getGeminiKey(),
      );
      cobrar(GEMINI_MODEL, t.usage);
      if (t.esBuzon) {
        // Termina aquí: no hay conversación que analizar y mandarlo al modelo
        // sería pagar por un "Buzón de voz" que ya conocemos.
        await markBuzon(cuenta, callId, t.text);
        return { ok: true, estado: 'analizada', buzon: true };
      }
      transcripcion = t.text;
      await markTranscrita(cuenta, callId, transcripcion);
    }

    const a = await analyzeTranscript(
      transcripcion,
      resolveAnalysisPrompt(client?.prompt_analisis, contexto ?? undefined),
      getOpenAIKey(),
    );
    cobrar(ANALYSIS_MODEL, a.usage);

    await markAnalizada(cuenta, callId, {
      tipo_contacto: a.TIPO_CONTACTO,
      presentacion:  a.PRESENTACION,
      precalif:      a.PRECALIFICACION,
      exploracion:   a.EXPLORACION,
      agenda:        a.AGENDAMIENTO,
      analisis:      a.RESUMEN,
    });
    return { ok: true, estado: 'analizada', buzon: false };
  } catch (e) {
    await markFallida(cuenta, callId, e);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[calls] ${slug}/${callId} falló: ${msg}`);
    return { ok: false, error: msg };
  }
}

/** Umbral de duración de un cliente, con el default del pipeline. */
export const MIN_DURACION_SEG = 100;

export function minDuracion(client?: ClientConfig): number {
  return client?.call_min_duration_seconds ?? MIN_DURACION_SEG;
}

export type { CallRow, Cuenta };
