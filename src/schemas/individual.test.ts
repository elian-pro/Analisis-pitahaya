import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nivelFromScore } from './individual';

test('cada umbral cae del lado correcto', () => {
  assert.equal(nivelFromScore(100), 'excelente');
  assert.equal(nivelFromScore(90),  'excelente');
  assert.equal(nivelFromScore(89),  'bueno');
  assert.equal(nivelFromScore(75),  'bueno');
  assert.equal(nivelFromScore(74),  'aceptable');
  assert.equal(nivelFromScore(60),  'aceptable');
  assert.equal(nivelFromScore(59),  'necesita_mejora');
  assert.equal(nivelFromScore(45),  'necesita_mejora');
  assert.equal(nivelFromScore(44),  'critico');
  assert.equal(nivelFromScore(0),   'critico');
});

test('mismo score, mismo nivel: la incoherencia del ranking ya no es posible', () => {
  // Ana 75 salia ACEPTABLE y Ernesto 75 NECESITA MEJORA en el mismo PDF.
  assert.equal(nivelFromScore(75), nivelFromScore(75));
  // Ricardo 49 salia con mejor nivel que Edwin 60.
  assert.ok(nivelFromScore(60) !== nivelFromScore(49));
});
