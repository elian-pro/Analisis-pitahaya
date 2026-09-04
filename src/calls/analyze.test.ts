import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTranscript, aplanar } from './analyze';

const COMPLETO = {
  TIPO_CONTACTO:   'primer contacto',
  PRESENTACION:    'Si',
  PRECALIFICACION: 'No',
  EXPLORACION:     'Si',
  AGENDAMIENTO:    'Whatsapp',
  RESUMEN:         'Resumen: la llamada fue breve.',
};

const openaiFake = (content: string, opts: { ok?: boolean; status?: number } = {}) => {
  const capturado: { body?: any; headers?: any } = {};
  const fn = (async (_url: string, init?: RequestInit) => {
    capturado.body = JSON.parse(String(init?.body));
    capturado.headers = init?.headers;
    if (opts.ok === false) {
      return { ok: false, status: opts.status ?? 500, text: async () => 'insufficient_quota' } as unknown as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fn, capturado };
};

test('un análisis bien formado se devuelve completo', async () => {
  const { fn, capturado } = openaiFake(JSON.stringify(COMPLETO));
  const r = await analyzeTranscript('**ASESOR:** Hola', 'SYSTEM', 'sk-1', fn);

  assert.equal(r.AGENDAMIENTO, 'Whatsapp');
  assert.equal(r.PRESENTACION, 'Si');
  assert.equal(capturado.body.model, 'gpt-4o-mini');
  assert.equal(capturado.body.response_format.type, 'json_object');
  assert.equal(capturado.body.messages[0].content, 'SYSTEM');
  assert.equal(capturado.body.messages[1].content, '**ASESOR:** Hola');
  assert.equal(capturado.headers.authorization, 'Bearer sk-1');
});

test('el RESUMEN se aplana a una sola línea', async () => {
  const { fn } = openaiFake(JSON.stringify({
    ...COMPLETO, RESUMEN: 'Resumen:\n\nfue breve.\n  Análisis:   ok.',
  }));
  const r = await analyzeTranscript('t', 's', 'k', fn);
  assert.equal(r.RESUMEN, 'Resumen: fue breve. Análisis: ok.');
  assert.ok(!r.RESUMEN.includes('\n'));
});

test('aplanar es idempotente', () => {
  const s = aplanar('a\n\n b   c');
  assert.equal(aplanar(s), s);
});

test('un JSON con la forma equivocada se rechaza en vez de guardarse', async () => {
  // Esto es lo que hoy nadie comprueba: n8n escribiría el objeto tal cual en el
  // Sheet y las columnas de calificación quedarían vacías sin ninguna señal.
  const { fn } = openaiFake(JSON.stringify({ resumen: 'minúsculas', otra_cosa: 1 }));
  await assert.rejects(() => analyzeTranscript('t', 's', 'k', fn), /forma esperada/);
});

test('un campo faltante se nombra en el error', async () => {
  const { AGENDAMIENTO, ...incompleto } = COMPLETO;
  const { fn } = openaiFake(JSON.stringify(incompleto));
  await assert.rejects(() => analyzeTranscript('t', 's', 'k', fn), /AGENDAMIENTO/);
});

test('una respuesta que no es JSON da un error legible', async () => {
  const { fn } = openaiFake('Lo siento, no puedo ayudarte con eso.');
  await assert.rejects(() => analyzeTranscript('t', 's', 'k', fn), /no devolvió JSON válido/);
});

test('un error de la API conserva el motivo', async () => {
  const { fn } = openaiFake('', { ok: false, status: 429 });
  await assert.rejects(() => analyzeTranscript('t', 's', 'k', fn), /429.*insufficient_quota/s);
});

test('captura usage cuando OpenAI lo manda, y sin el sigue valido', async () => {
  const conUsage = (async () => ({
    ok: true, status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(COMPLETO) } }],
      usage: { prompt_tokens: 900, completion_tokens: 60 },
    }),
  })) as unknown as typeof globalThis.fetch;
  const r1 = await analyzeTranscript('t', 'p', 'k', conUsage);
  assert.deepEqual(r1.usage, { input: 900, output: 60 });

  const { fn } = openaiFake(JSON.stringify(COMPLETO));
  const r2 = await analyzeTranscript('t', 'p', 'k', fn);
  assert.equal(r2.usage, undefined);              // telemetria ausente ≠ error
  assert.equal(r2.TIPO_CONTACTO, COMPLETO.TIPO_CONTACTO);
});
