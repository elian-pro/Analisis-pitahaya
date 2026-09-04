import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeEntrega } from './manager';

test('gestionados entregan por Drive con radar y sidecars', () => {
  for (const src of [undefined, 'sheets', 'postgres'] as const) {
    assert.deepEqual(planDeEntrega({ calls_source: src }),
      { drive: true, sidecarsDrive: true, radar: true, vault: false });
  }
});

test('cliente externo: descarga efimera, nada de Drive ni Radar', () => {
  assert.deepEqual(planDeEntrega({ calls_source: 'cliente_pg' }),
    { drive: false, sidecarsDrive: false, radar: false, vault: true });
});
