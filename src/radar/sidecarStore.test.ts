import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveRadarSidecar, findRadarSidecarInDb } from './sidecarStore';

// Sin DATABASE_URL (como corre `npm test`) las dos funciones son no-op. Lo que
// se fija aqui es que ninguna lanza: si guardar el sidecar tumbara el flujo, un
// Radar ya generado y pagado se perderia por no poder anotar el comparativo del
// mes que viene; y si leerlo lanzara, el cliente se quedaria sin reporte por no
// poder mirar el mes pasado. Las dos degradan a "sin comparativo", nunca a
// "sin reporte".

test('guardar sin base no lanza', async () => {
  await assert.doesNotReject(() => saveRadarSidecar('acme', '2026-08', '{"objeciones":[]}'));
});

test('leer sin base devuelve undefined, no lanza', async () => {
  assert.equal(await findRadarSidecarInDb('acme', '2026-08'), undefined);
});
