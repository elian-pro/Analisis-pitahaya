import { test } from 'node:test';
import assert from 'node:assert';
import { weekLabel, monthLabel } from './labels';

// El periodo que se anuncia en Google Chat. Antes salía en crudo ("2026-07-27 —
// 2026-08-02"); si esto se rompe, el equipo vuelve a leer fechas ISO.

test('semana dentro del mismo mes', () => {
  assert.strictEqual(weekLabel('2026-07-06', '2026-07-12'), '06 jul – 12 jul 2026');
});

test('semana que cruza de mes: el año se escribe una vez', () => {
  assert.strictEqual(weekLabel('2026-07-27', '2026-08-02'), '27 jul – 02 ago 2026');
});

test('semana que cruza de año: se escriben los dos años', () => {
  assert.strictEqual(weekLabel('2025-12-29', '2026-01-04'), '29 dic 2025 – 04 ene 2026');
});

test('el mes se sigue anunciando con nombre y año', () => {
  assert.strictEqual(monthLabel('2026-06'), 'Junio 2026');
});
