import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientId, type RosterEntry } from './resolveClient';
import { normalizeCall } from './normalize';

const llamada = (asesor: string, origen?: string) => normalizeCall({
  call_id: 'o-1', callpicker_destination_name: asesor, callpicker_description: origen,
});

const ROSTERS: RosterEntry[] = [
  { clientId: 'midstorage', advisorNames: ['Claudia Proclama', 'José Ambrosio'], callpickerTag: 'ZD - Midstorage' },
  { clientId: 'grupo_gira', advisorNames: ['Ana Ruiz'], callpickerTag: 'ZD - Gira' },
];

test('un asesor en un solo roster resuelve directo', () => {
  assert.deepEqual(resolveClientId(llamada('Claudia Proclama'), ROSTERS),
    { clientId: 'midstorage', via: 'roster' });
});

test('el nombre se compara sin distinguir mayúsculas ni espacios', () => {
  for (const v of ['  claudia proclama ', 'CLAUDIA PROCLAMA', 'Claudia Proclama']) {
    assert.equal((resolveClientId(llamada(v), ROSTERS) as any).clientId, 'midstorage');
  }
});

test('un asesor desconocido no se asigna a nadie', () => {
  assert.deepEqual(resolveClientId(llamada('Pedro Nadie'), ROSTERS),
    { clientId: null, motivo: 'sin_roster' });
});

test('sin asesor tampoco se inventa un cliente', () => {
  assert.equal(resolveClientId(llamada(''), ROSTERS).clientId, null);
});

// El caso que documenta advisors/match.ts: mismo equipo, dos productos.
const COMPARTIDO: RosterEntry[] = [
  { clientId: 'alquimia', advisorNames: ['Ana Ruiz'], callpickerTag: 'ZD - Alquimia' },
  { clientId: 'acalai',   advisorNames: ['Ana Ruiz'], callpickerTag: 'ZD - Acalai' },
];

test('un asesor en dos rosters se desempata por el origen del webhook', () => {
  assert.deepEqual(resolveClientId(llamada('Ana Ruiz', 'ZD - Acalai'), COMPARTIDO),
    { clientId: 'acalai', via: 'tag' });
});

test('sin origen que desempate queda ambiguo, no se elige al azar', () => {
  assert.deepEqual(resolveClientId(llamada('Ana Ruiz'), COMPARTIDO),
    { clientId: null, motivo: 'ambiguo' });
});

test('un origen que no coincide con ningún tag deja la llamada ambigua', () => {
  assert.deepEqual(resolveClientId(llamada('Ana Ruiz', 'ZD - Otro'), COMPARTIDO),
    { clientId: null, motivo: 'ambiguo' });
});

test('el tag no rescata a un asesor que no está en ningún roster', () => {
  // El tag solo desempata entre candidatos; nunca asigna por sí solo, porque el
  // roster es la frontera real entre clientes.
  assert.deepEqual(resolveClientId(llamada('Pedro Nadie', 'ZD - Acalai'), COMPARTIDO),
    { clientId: null, motivo: 'sin_roster' });
});

test('sin rosters cargados no se asigna nada', () => {
  assert.equal(resolveClientId(llamada('Claudia Proclama'), []).clientId, null);
});
