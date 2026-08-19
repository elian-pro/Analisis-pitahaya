import { getGeminiKey, getOpenAIKey } from '../config/env';
import { loadClients, type ClientConfig } from '../clients/manager';
import { listAdvisors } from '../advisors/store';
import { normalizeCall, evaluateCall, MIN_CALL_DURATION_SECONDS, type NormalizedCall } from './normalize';
import { resolveClientId, type RosterEntry } from './resolveClient';
import { resolveTranscriptionPrompt, resolveAnalysisPrompt } from './prompts';
import { transcribeAudio } from './transcribe';
import { analyzeTranscript } from './analyze';
import {
  insertCall, getCall, markTranscrita, markAnalizada, markBuzon,
  markDescartada, markFallida, type CallRow,
} from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Orquestación: recepción y procesamiento de una llamada.
//
// Cada paso persiste antes de arrancar el siguiente. Si Gemini falla, la fila ya
// está guardada y el barrido la recoge; si falla el análisis, la transcripción
// ya está en la base y no se vuelve a pagar. En n8n no se escribía NADA hasta
// terminar todo el pipeline, así que un fallo a mitad perdía la llamada entera.
//
// Este es el único módulo del directorio que toca credenciales y base de datos;
// la lógica decidible vive en normalize.ts, resolveClient.ts y prompts.ts, que
// se verifican sin entorno.
// ─────────────────────────────────────────────────────────────────────────────

/** Rosters de todos los clientes, para resolver de quién es cada llamada. */
export async function loadRosters(): Promise<RosterEntry[]> {
  return rostersFor(await loadClients());
}

async function rostersFor(clients: ClientConfig[]): Promise<RosterEntry[]> {
  return Promise.all(clients.map(async (c) => ({
    clientId:      c.id,
    // Incluye inactivos: un asesor dado de baja hoy sigue siendo el dueño de sus
    // llamadas de ayer. Mismo criterio que radar/dbFlow.ts:82.
    advisorNames:  (await listAdvisors(c.id, { includeInactive: true })).map(a => a.name),
    callpickerTag: c.callpicker_tag ?? null,
  })));
}

export interface IngestResult {
  call_id:  string;
  nueva:    boolean;
  estado:   string;
  client_id: string | null;
}

/**
 * Guarda el evento recibido y decide en qué estado nace. NO transcribe: eso lo
 * hace processCall(), para que el webhook pueda responder de inmediato.
 */
export async function ingestCall(payload: Record<string, unknown>): Promise<IngestResult> {
  const call = normalizeCall(payload);
  const clients = await loadClients();
  const resolved = resolveClientId(call, await rostersFor(clients));
  const clientId = resolved.clientId;

  let estado: 'recibida' | 'descartada' | 'sin_asignar' = 'recibida';
  let motivo: string | null = null;

  if (!clientId) {
    // No se pierde: queda listada para asignarla a mano.
    estado = 'sin_asignar';
    motivo = 'motivo' in resolved && resolved.motivo === 'ambiguo'
      ? `El asesor "${call.asesor}" está en varios clientes y el origen no desempata`
      : `El asesor "${call.asesor}" no está en el roster de ningún cliente`;
  } else {
    const descarte = evaluateCall(call, minDuration(clients.find(c => c.id === clientId)));
    if (descarte) { estado = 'descartada'; motivo = descarte.reason; }
  }

  const nueva = await insertCall(call, clientId, estado, motivo);
  return { call_id: call.call_id, nueva, estado, client_id: clientId };
}

const minDuration = (c?: ClientConfig): number =>
  c?.call_min_duration_seconds ?? MIN_CALL_DURATION_SECONDS;

export type ProcessOutcome =
  | { ok: true;  estado: 'analizada' | 'descartada'; buzon: boolean }
  | { ok: false; error: string };

/**
 * Lleva una llamada hasta el final desde donde se haya quedado. Es idempotente
 * en el sentido que importa: una llamada ya transcrita no se vuelve a transcribir
 * (el paso caro), solo se reanuda el análisis.
 *
 * `force` reprocesa desde cero, para cuando cambia el prompt de un cliente.
 */
export async function processCall(callId: string, force = false): Promise<ProcessOutcome> {
  const row = await getCall(callId);
  if (!row) return { ok: false, error: `No existe la llamada ${callId}` };
  if (!row.client_id) return { ok: false, error: 'La llamada no tiene cliente asignado' };
  if (row.estado === 'descartada' && !force) {
    return { ok: true, estado: 'descartada', buzon: false };
  }

  const client = (await loadClients()).find(c => c.id === row.client_id);
  if (!client) return { ok: false, error: `El cliente '${row.client_id}' ya no existe` };

  try {
    let transcripcion = force ? null : row.transcripcion;

    if (!transcripcion) {
      if (!row.record) throw new Error('La llamada no tiene grabación');
      const t = await transcribeAudio(
        row.record,
        resolveTranscriptionPrompt(client.prompt_transcripcion, client.contexto_negocio),
        getGeminiKey(),
      );
      if (t.esBuzon) {
        // El buzón termina aquí: no hay conversación que analizar, y mandarlo al
        // modelo sería pagar por un "Buzón de voz" que ya conocemos.
        await markBuzon(callId, t.text);
        return { ok: true, estado: 'analizada', buzon: true };
      }
      transcripcion = t.text;
      await markTranscrita(callId, transcripcion);
    }

    const a = await analyzeTranscript(
      transcripcion,
      resolveAnalysisPrompt(client.prompt_analisis, client.contexto_negocio),
      getOpenAIKey(),
    );

    await markAnalizada(callId, {
      tipo_contacto: a.TIPO_CONTACTO,
      presentacion:  a.PRESENTACION,
      precalif:      a.PRECALIFICACION,
      exploracion:   a.EXPLORACION,
      agenda:        a.AGENDAMIENTO,
      analisis:      a.RESUMEN,
    });
    return { ok: true, estado: 'analizada', buzon: false };
  } catch (e) {
    await markFallida(callId, e);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[calls] ${callId} falló: ${msg}`);
    return { ok: false, error: msg };
  }
}

/** Marca como descartada una llamada que ya no cumple el filtro. */
export async function discardCall(callId: string, motivo: string): Promise<void> {
  await markDescartada(callId, motivo);
}

export type { CallRow };
