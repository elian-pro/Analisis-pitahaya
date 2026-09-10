import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivePdf, readArchive } from './archive';

// Estas pruebas corren SIN DATABASE_URL (como corre `npm test`), asi que ningun
// cliente tiene base configurada y tenantTarget lanza. Es poco codigo, pero fija
// los dos contratos que de verdad importan:
//
//   1. Archivar nunca tumba una entrega. El PDF ya se genero y se cobro en
//      tokens; si su base no responde, el cliente aun tiene su descarga.
//   2. Y sin embargo el fallo NO se finge como exito. Pasados los 30 minutos de
//      la guarda efimera esta es la unica copia que le queda: tragarselo en
//      silencio perdia el reporte sin que nadie se enterara.
//
// Los dos juntos son el motivo de que archivePdf devuelva un resultado en vez
// de void. Si alguien lo simplifica a void, estas pruebas caen.

const PDF = Buffer.from('%PDF-1.4');

test('sin base del cliente, archivar no lanza', async () => {
  await assert.doesNotReject(() => archivePdf({
    id: 'job-1', clientId: 'acme', kind: 'analisis',
    periodKey: '2026-08', filename: 'x.pdf', pdf: PDF,
  }));
});

test('sin base del cliente, archivar avisa del fallo con su motivo', async () => {
  const r = await archivePdf({
    id: 'job-1', clientId: 'acme', kind: 'analisis',
    periodKey: '2026-08', filename: 'x.pdf', pdf: PDF,
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo ?? '', /base de datos/i);
});

test('un PDF por encima del tope se rechaza sin intentar conectar', async () => {
  // 51 MB: por encima del tope de 50 MB, que existe porque node-pg materializa
  // el bytea entero en un Buffer.
  const r = await archivePdf({
    id: 'job-2', clientId: 'acme', kind: 'radar',
    periodKey: '2026-08', filename: 'gordo.pdf', pdf: Buffer.alloc(51 * 1024 * 1024),
  });
  assert.equal(r.ok, false);
  assert.match(r.motivo ?? '', /tope/i);
});

test('leer sin base devuelve undefined, no lanza', async () => {
  assert.equal(await readArchive('acme', 'job-1'), undefined);
});
