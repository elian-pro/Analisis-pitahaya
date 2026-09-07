import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// `_callBodyHtml` vive en index.html (la SPA es un solo archivo). Se extrae y se
// ejecuta con helpers falsos, como hace nextRun.test.ts: es la única lógica del
// panel de detalle que no es DOM, y la que de verdad puede romperse en silencio.

function loadCallBodyHtml(): (c: Record<string, unknown>) => string {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf-8');
  const firma = 'function _callBodyHtml(c, esc = _esc, fechaHora = _fechaHora, caja = _cajaHtml) {';
  const start = html.indexOf(firma);
  assert.notEqual(start, -1, '_callBodyHtml ya no está en index.html');
  let depth = 0, i = html.indexOf('{', start + firma.length - 1);
  const from = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  const body = html.slice(from + 1, i);
  const fn = new Function('c', 'esc', 'fechaHora', 'caja', body) as
    (c: unknown, esc: unknown, f: unknown, caja: unknown) => string;

  const esc = (s: string) => String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
  const caja = (label: string, inner: string, id?: string) =>
    `<CAJA label="${label}"${id ? ` id="${id}"` : ''}>${inner}</CAJA>`;
  return (c) => fn(c, esc, (v: string) => `FECHA(${v})`, caja);
}

const render = loadCallBodyHtml();

const LLAMADA = {
  contraparte_numero: '55 1234 5678', ciudad: 'CDMX', estatus: 'Contestada',
  tipo_contacto: 'primer contacto', presentacion: 'Si', precalif: 'No',
  exploracion: 'Si', agenda: 'Whatsapp', analisis: 'Buena apertura.',
  calif_global: 75, error: null, intentos: 1, record: 'https://x/a.mp3',
  procesado_at: '2026-09-01T16:05:00Z', tiene_transcripcion: true,
};

test('el análisis se escapa: ese texto viene de la base del cliente, no de aquí', () => {
  // El análisis lo escribe un modelo sobre una transcripción ajena y viaja por
  // la base de Callpicker. Es un límite de confianza, no un detalle estético.
  const html = render({ ...LLAMADA, analisis: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'), 'inyectó un <script> sin escapar');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('una llamada sin nada procesado no imprime null ni undefined', () => {
  // Es el caso mayoritario: las llamadas 'corta' y 'sin_procesar' no tienen
  // fila en `analisis`, así que llegan con todo a null.
  const html = render({
    contraparte_numero: null, ciudad: null, estatus: null, tipo_contacto: null,
    presentacion: null, precalif: null, exploracion: null, agenda: null,
    analisis: null, calif_global: null, error: null, intentos: null,
    record: null, procesado_at: null, tiene_transcripcion: false,
  });
  assert.ok(!/\bnull\b/.test(html), 'se coló un null en el HTML');
  assert.ok(!/\bundefined\b/.test(html), 'se coló un undefined en el HTML');
  assert.ok(!html.includes('Procesada'), 'sin procesar no debe pintar la fecha de proceso');
  assert.ok(!html.includes('Criterios'), 'sin criterios no debe pintar la rejilla vacía');
  assert.ok(html.includes('Sin análisis'));
});

test('sin transcripción no se pinta su caja: no hay nada que cargar', () => {
  const sin = render({ ...LLAMADA, tiene_transcripcion: false });
  assert.ok(!sin.includes('id="cd-trans"'));
  const con = render(LLAMADA);
  assert.ok(con.includes('id="cd-trans"'));
  assert.ok(con.includes('Cargando'), 'la caja debe arrancar en estado de carga');
});

test('los cuatro criterios van cada uno con su etiqueta', () => {
  // Antes iban aplastados en una línea con puntos medios y había que contar
  // posiciones para saber cuál era cuál.
  const html = render(LLAMADA);
  for (const k of ['Presentación', 'Precalificación', 'Exploración', 'Agenda']) {
    assert.ok(html.includes(k), `falta el criterio ${k}`);
  }
  assert.ok(html.includes('Whatsapp'));
});

test('un criterio vacío sale como raya, no como hueco', () => {
  const html = render({ ...LLAMADA, precalif: null });
  assert.ok(html.includes('Criterios'), 'con tres de cuatro sigue habiendo rejilla');
  assert.ok(html.includes('—'));
});

test('el error del pipeline se muestra con sus intentos', () => {
  const html = render({ ...LLAMADA, error: 'Gemini respondió 429', intentos: 3 });
  assert.match(html, /Gemini respondió 429/);
  assert.match(html, /3 intento\(s\)/);
});
