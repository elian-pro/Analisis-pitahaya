import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterMatcher } from './match';

// El Radar decide que llamadas de la hoja pertenecen al cliente con este matcher.
// Dos clientes pueden compartir la hoja, asi que es la frontera entre sus reportes.

test('el roster separa dos equipos que comparten la misma hoja', () => {
  const esDelEquipoA = rosterMatcher(['Ana Hernández', 'Ernesto Marín']);
  assert.ok(esDelEquipoA('Ana Hernández'));
  assert.ok(!esDelEquipoA('Ricardo Maza'));    // asesor del otro producto
});

test('tolera espacios y mayusculas de la hoja', () => {
  const esMio = rosterMatcher(['Ana Hernández']);
  assert.ok(esMio('  Ana Hernández '));
  assert.ok(esMio('ANA HERNÁNDEZ'));
});

test('no empareja nombres distintos, vacios ni sin tilde', () => {
  const esMio = rosterMatcher(['Ana Hernández']);
  assert.ok(!esMio('Ana'));
  assert.ok(!esMio(''));
  assert.ok(!esMio('Ana Hernandez'));   // la tilde cuenta: los nombres deben coincidir
});

test('un roster vacio no reclama ninguna llamada', () => {
  assert.ok(!rosterMatcher([])('Ana Hernández'));
});
