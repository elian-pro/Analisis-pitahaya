// Traduce el evento crudo del webhook de Callpicker a una fila de `calls`.
//
// Vive aparte del store y del pipeline para que no arrastre la conexión a la
// base al importarse: así se puede verificar sin entorno configurado, igual que
// advisors/match.ts.
//
// Tres cosas que el pipeline de n8n hace mal y aquí se corrigen:
//   • La fecha: n8n estampa $now (el momento en que procesó), no cuándo ocurrió
//     la llamada. El evento trae `created` en epoch ms, que es inequívoco.
//   • El teléfono: n8n usa `callpicker_number`, que es la línea SALIENTE de la
//     empresa (dos valores en todo el histórico), no el del prospecto. El del
//     prospecto es `callee_number`.
//   • La identidad: n8n descarta `call_id`, y sin él no hay forma de evitar
//     duplicados al reprocesar.

export interface NormalizedCall {
  call_id:           string;
  fecha:             Date;
  asesor:            string;
  callee_number:     string | null;
  callee_city:       string | null;
  callee_state:      string | null;
  call_status:       string | null;
  wait_time:         number | null;
  duracion_segundos: number;
  record:            string | null;
  /** `callpicker_description` ("ZD - Midstorage"): pista para resolver el cliente. */
  origen:            string | null;
  raw:               unknown;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * `records` llega como string con un array JSON —`'["https://…"]'`— pero se
 * acepta también el array ya parseado, porque un webhook mal configurado o un
 * reenvío manual pueden mandarlo de cualquiera de las dos formas.
 */
export function firstRecordUrl(records: unknown): string | null {
  if (!records) return null;
  let arr: unknown = records;
  if (typeof records === 'string') {
    const s = records.trim();
    if (!s || s === '[]') return null;
    try { arr = JSON.parse(s); } catch { return s.startsWith('http') ? s : null; }
  }
  if (!Array.isArray(arr)) return null;
  return str(arr[0]);
}

// "2026-7-15 9:18:39" — mes, día y hora vienen SIN cero a la izquierda, que no es
// ISO. Se parsea explícitamente en vez de dejárselo a `new Date(string)`, cuyo
// comportamiento con formatos no ISO depende del motor.
const LOOSE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/;

export function parseLooseDate(raw: unknown): Date | null {
  const s = str(raw);
  if (!s) return null;
  const m = s.match(LOOSE_DATE);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Cuándo ocurrió la llamada. `created` (epoch ms) manda porque no depende de
 * zona horaria ni de formato; `date` es el respaldo y se interpreta en la zona
 * del servidor.
 *
 * ponytail: sin `created` ni `date` legibles cae a "ahora", que es la fecha
 * equivocada — pero perder la llamada entera sería peor. Queda visible porque
 * el resto de la fila sí se guarda.
 */
export function eventDate(payload: Record<string, unknown>): Date {
  const ms = num(payload.created);
  if (ms !== null && ms > 0) {
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }
  return parseLooseDate(payload.date) ?? new Date();
}

export function normalizeCall(payload: Record<string, unknown>): NormalizedCall {
  const call_id = str(payload.call_id);
  // Sin identidad no hay idempotencia posible, y una llamada duplicada cuesta
  // dos transcripciones. Es el único campo cuya ausencia aborta.
  if (!call_id) throw new Error('El evento no trae `call_id`; sin él no se puede evitar duplicados.');

  return {
    call_id,
    fecha:             eventDate(payload),
    asesor:            str(payload.callpicker_destination_name) ?? '',
    callee_number:     str(payload.callee_number),
    callee_city:       str(payload.callee_city),
    callee_state:      str(payload.callee_state),
    call_status:       str(payload.call_status),
    wait_time:         num(payload.wait_time),
    duracion_segundos: num(payload.duration_sec) ?? 0,
    record:            firstRecordUrl(payload.records),
    origen:            str(payload.callpicker_description),
    raw:               payload,
  };
}

/** Umbral por defecto, el mismo que aplica hoy el lector de Sheets. */
export const MIN_CALL_DURATION_SECONDS = 90;

export interface DiscardReason { discard: true; reason: string }

/**
 * Decide si una llamada merece transcribirse. Separado de `normalizeCall` para
 * que el umbral —que es política por cliente— no se mezcle con el mapeo de
 * campos, que es puro.
 *
 * Que esto viva aquí y no en el flujo es justo lo que hoy falla en n8n: el
 * filtro cuelga del trigger continuo, así que el backfill manual lo esquiva y
 * transcribe audios de 20 s que después nadie usa. Aquí no hay forma de entrar
 * al pipeline sin pasar por esta puerta.
 */
export function evaluateCall(
  call: NormalizedCall,
  minDurationSeconds: number = MIN_CALL_DURATION_SECONDS,
): DiscardReason | null {
  if (!call.record) return { discard: true, reason: 'Sin grabación disponible' };
  if (call.duracion_segundos < minDurationSeconds) {
    return { discard: true, reason: `Duración ${call.duracion_segundos}s < ${minDurationSeconds}s` };
  }
  return null;
}
