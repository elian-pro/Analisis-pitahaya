import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corteRetencion, purgeOnce } from './purge';

// El reloj falso es el argumento: corteRetencion recibe el `ahora` en vez de
// llamar a Date.now(), igual que PdfVault recibe su `now`. Sin base, purgeOnce
// no toca nada.

const DIA = 24 * 60 * 60 * 1000;
const AHORA = Date.parse('2026-09-09T12:00:00.000Z');

test('el corte cae exactamente 90 dias atras', () => {
  assert.equal(corteRetencion(AHORA).toISOString(), '2026-06-11T12:00:00.000Z');
});

test('un documento de 89 dias y 23 horas sobrevive; uno de 90 dias y un minuto cae', () => {
  const corte = corteRetencion(AHORA).getTime();
  assert.ok(AHORA - (89 * DIA + 23 * 60 * 60 * 1000) > corte, 'el de 89d23h deberia sobrevivir');
  assert.ok(AHORA - (90 * DIA + 60 * 1000) < corte, 'el de 90d1min deberia caer');
});

// El DELETE usa `created_at < $1`: una fila creada JUSTO en el instante del
// corte no es anterior a el, asi que se queda. Se fija aqui para que nadie
// cambie el operador a <= sin darse cuenta de que adelanta el borrado un tick.
test('una fila creada justo en el corte no se borra', () => {
  const corte = corteRetencion(AHORA).getTime();
  assert.equal(corte < corte, false);
});

test('la ventana es configurable', () => {
  assert.equal(corteRetencion(AHORA, 1).toISOString(), '2026-09-08T12:00:00.000Z');
  assert.equal(corteRetencion(AHORA, 0).toISOString(), '2026-09-09T12:00:00.000Z');
});

test('sin base configurada, la pasada no borra nada y no lanza', async () => {
  assert.deepEqual(await purgeOnce(() => AHORA), { pdfs: 0, jobs: 0 });
});
