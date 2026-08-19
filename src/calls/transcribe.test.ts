import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esBuzonDeVoz, downloadAudio, transcribeAudio, MAX_AUDIO_BYTES } from './transcribe';

test('el buzón se detecta sin importar mayúsculas ni tilde', () => {
  // Los tres flujos de n8n escriben esta cadena de forma distinta: el prompt de
  // Midstorage pide minúscula, el Switch de Sofía compara contra mayúscula. Una
  // sola regla tiene que cubrir todas.
  for (const v of ['buzón de voz', 'Buzón de voz', 'BUZÓN DE VOZ', 'buzon de voz',
                   '  buzón de voz  ', 'buzón de voz.', '"buzón de voz"']) {
    assert.equal(esBuzonDeVoz(v), true, `debería ser buzón: ${JSON.stringify(v)}`);
  }
});

test('una transcripción real que menciona el buzón NO es un buzón', () => {
  // La regla ancla la cadena completa; si solo buscara la subcadena, una llamada
  // donde el asesor dice "le dejé buzón de voz" se marcaría como contestadora y
  // se quedaría sin análisis.
  assert.equal(
    esBuzonDeVoz('**ASESOR:** Le marqué ayer y me salió buzón de voz **PROSPECTO:** Sí, disculpe'),
    false,
  );
  assert.equal(esBuzonDeVoz(''), false);
});

const respuesta = (body: Buffer, ct = 'audio/mpeg', ok = true, status = 200) => ({
  ok, status,
  headers: { get: (h: string) => (h === 'content-type' ? ct : null) },
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
}) as unknown as Response;

test('el audio se descarga y se codifica a base64', async () => {
  const audio = Buffer.from('fake-mp3-bytes');
  const r = await downloadAudio('https://x/a.mp3', async () => respuesta(audio));
  assert.equal(Buffer.from(r.base64, 'base64').toString(), 'fake-mp3-bytes');
  assert.equal(r.mimeType, 'audio/mpeg');
});

test('el content-type se limpia de parámetros', async () => {
  const r = await downloadAudio('https://x/a.mp3', async () =>
    respuesta(Buffer.from('x'), 'audio/mpeg; charset=binary'));
  assert.equal(r.mimeType, 'audio/mpeg');
});

test('un audio que ya no existe da un error legible', async () => {
  await assert.rejects(
    () => downloadAudio('https://x/a.mp3', async () => respuesta(Buffer.alloc(0), 'text/html', false, 404)),
    /HTTP 404/,
  );
});

test('un audio vacío no llega a Gemini', async () => {
  await assert.rejects(
    () => downloadAudio('https://x/a.mp3', async () => respuesta(Buffer.alloc(0))),
    /vacía/,
  );
});

test('un audio gigante se rechaza antes de codificarlo', async () => {
  const enorme = Buffer.alloc(MAX_AUDIO_BYTES + 1);
  await assert.rejects(() => downloadAudio('https://x/a.mp3', async () => respuesta(enorme)), /límite/);
});

// Doble que responde primero al audio y después a Gemini.
function geminiFake(texto: string, opts: { ok?: boolean; status?: number; body?: string } = {}) {
  let llamada = 0;
  const capturado: { url?: string; body?: any } = {};
  const fn = (async (url: string, init?: RequestInit) => {
    if (++llamada === 1) return respuesta(Buffer.from('audio'));
    capturado.url = url;
    capturado.body = JSON.parse(String(init?.body));
    if (opts.ok === false) {
      return { ok: false, status: opts.status ?? 500, text: async () => opts.body ?? 'boom' } as unknown as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fn, capturado };
}

test('una transcripción normal vuelve marcada como no-buzón', async () => {
  const { fn, capturado } = geminiFake('**ASESOR:** Hola **PROSPECTO:** Buenos días');
  const r = await transcribeAudio('https://x/a.mp3', 'PROMPT', 'k-123', fn);

  assert.equal(r.esBuzon, false);
  assert.match(r.text, /ASESOR/);
  // El audio viaja inline en base64, no como URL.
  assert.equal(capturado.body.contents[0].parts[1].inline_data.mime_type, 'audio/mpeg');
  assert.equal(
    Buffer.from(capturado.body.contents[0].parts[1].inline_data.data, 'base64').toString(),
    'audio',
  );
  assert.equal(capturado.body.contents[0].parts[0].text, 'PROMPT');
});

test('un buzón vuelve marcado como tal', async () => {
  const { fn } = geminiFake('buzón de voz');
  assert.equal((await transcribeAudio('https://x/a.mp3', 'P', 'k', fn)).esBuzon, true);
});

test('un error de Gemini conserva el motivo, no solo el código', async () => {
  const { fn } = geminiFake('', { ok: false, status: 429, body: 'RESOURCE_EXHAUSTED: quota' });
  await assert.rejects(
    () => transcribeAudio('https://x/a.mp3', 'P', 'k', fn),
    /429.*RESOURCE_EXHAUSTED/s,
  );
});

test('una respuesta sin texto no se guarda como transcripción vacía', async () => {
  const fn = (async (_u: string, init?: RequestInit) =>
    init ? { ok: true, status: 200, json: async () => ({ candidates: [] }) } as unknown as Response
         : respuesta(Buffer.from('audio'))) as unknown as typeof globalThis.fetch;
  await assert.rejects(() => transcribeAudio('https://x/a.mp3', 'P', 'k', fn), /sin texto/);
});
