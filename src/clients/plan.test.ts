import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeEntrega } from './manager';

test('gestionados entregan por Drive con radar y sidecars', () => {
  for (const src of [undefined, 'sheets', 'postgres'] as const) {
    assert.deepEqual(planDeEntrega({ calls_source: src }),
      { drive: true, sidecarsDrive: true, radar: true, vault: false, archivo: false });
  }
});

test('cliente externo: descarga efimera y archivo, nada de Drive', () => {
  assert.deepEqual(planDeEntrega({ calls_source: 'cliente_pg' }),
    { drive: false, sidecarsDrive: false, radar: true, vault: true, archivo: true });
});

// Esta es LA garantia de "solo clientes externos" del archivo de 90 dias: el
// unico booleano que mantiene los PDF de los gestionados fuera de la base. Si
// alguna vez se pone en true para otra fuente, se estaria guardando el reporte
// de un cliente que ya tiene su copia en Drive, y encima sin haberlo pactado.
test('archivo: solo cliente_pg, nunca un gestionado', () => {
  assert.equal(planDeEntrega({ calls_source: 'cliente_pg' }).archivo, true);
  for (const src of [undefined, 'sheets', 'postgres'] as const) {
    assert.equal(planDeEntrega({ calls_source: src }).archivo, false);
  }
});
