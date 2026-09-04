import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoginThrottle } from './rateLimit';

// Reloj inyectado: los tests no duermen.

test('permite 5 intentos y bloquea el sexto', () => {
  let now = 1_000;
  const t = new LoginThrottle(() => now);
  for (let i = 0; i < 5; i++) assert.equal(t.allowed('ana@acme.com|1.2.3.4'), true);
  assert.equal(t.allowed('ana@acme.com|1.2.3.4'), false);
  // Otra llave no se ve afectada.
  assert.equal(t.allowed('otro@acme.com|1.2.3.4'), true);
  void now;
});

test('pasada la ventana se vuelve a permitir', () => {
  let now = 0;
  const t = new LoginThrottle(() => now);
  for (let i = 0; i < 6; i++) t.allowed('k');
  assert.equal(t.allowed('k'), false);
  now += 15 * 60 * 1000 + 1;
  assert.equal(t.allowed('k'), true);
});

test('un login correcto limpia el contador', () => {
  let now = 0;
  const t = new LoginThrottle(() => now);
  for (let i = 0; i < 4; i++) t.allowed('k');
  t.clear('k');
  for (let i = 0; i < 5; i++) assert.equal(t.allowed('k'), true);
  void now;
});
