import { test } from 'node:test';
import assert from 'node:assert/strict';

// dbFlow arrastra a config/env, que aborta el proceso si faltan las credenciales.
// El cálculo de quincenas es aritmética de fechas y no las necesita, así que se
// rellenan con valores de juguete y se carga el módulo después (require, no
// import, para que no se adelante a estas líneas).
process.env.GOOGLE_SA_JSON    ||= '{}';
process.env.ANTHROPIC_API_KEY ||= 'test';
const { fortnightFor, fortnightForRun } = require('./dbFlow') as typeof import('./dbFlow');

test('fortnightFor: Q1 va del 1 al 15 y compara contra la Q2 del mes anterior', () => {
  const f = fortnightFor('2026-06', 'Q1');
  assert.equal(f.periodKey, '2026-06-Q1');
  assert.equal(f.dateFrom, '2026-06-01');
  assert.equal(f.dateTo, '2026-06-15');
  assert.equal(f.month, '2026-06');
  assert.equal(f.prevPeriodKey, '2026-05-Q2');
});

test('fortnightFor: Q2 llega al último día real del mes', () => {
  assert.equal(fortnightFor('2026-06', 'Q2').dateTo, '2026-06-30');   // 30 días
  assert.equal(fortnightFor('2026-07', 'Q2').dateTo, '2026-07-31');   // 31 días
  assert.equal(fortnightFor('2026-02', 'Q2').dateTo, '2026-02-28');   // febrero
  assert.equal(fortnightFor('2028-02', 'Q2').dateTo, '2028-02-29');   // bisiesto
});

test('fortnightFor: Q2 compara contra la Q1 de su propio mes', () => {
  assert.equal(fortnightFor('2026-06', 'Q2').prevPeriodKey, '2026-06-Q1');
});

test('fortnightForRun: del 16 en adelante, la quincena cerrada es la Q1 del mes en curso', () => {
  const f = fortnightForRun('2026-06-20');
  assert.equal(f.periodKey, '2026-06-Q1');
});

test('fortnightForRun: antes del 16, es la Q2 del mes anterior (y cruza el año)', () => {
  assert.equal(fortnightForRun('2026-06-03').periodKey, '2026-05-Q2');
  assert.equal(fortnightForRun('2026-01-10').periodKey, '2025-12-Q2');
});
