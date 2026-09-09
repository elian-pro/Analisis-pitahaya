import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archivePdf, listArchive, readArchive, RETENCION_DIAS } from './archive';

// Estas pruebas corren SIN DATABASE_URL (como corre `npm test`), asi que
// dbEnabled es false. Es poco, pero fija el unico contrato que de verdad
// importa: archivar es un extra sobre una entrega que ya ocurrio, y no puede
// tumbarla nunca. Si esto empieza a lanzar, un reporte generado y cobrado se
// pierde por no poder guardar una copia.

test('sin base configurada, archivar no lanza ni hace nada', async () => {
  await assert.doesNotReject(() => archivePdf({
    id: 'job-1', clientId: 'acme', kind: 'analisis',
    periodKey: '2026-08', filename: 'x.pdf', pdf: Buffer.from('%PDF-1.4'),
  }));
});

test('sin base configurada, el listado sale vacio y la lectura undefined', async () => {
  assert.deepEqual(await listArchive('acme'), []);
  assert.equal(await readArchive('job-1', 'acme'), undefined);
});

test('un PDF por encima del tope se descarta sin lanzar', async () => {
  // 51 MB: por encima del tope de 50 MB. Se descarta y se registra; el cliente
  // ya tiene su descarga, que es lo que no puede romperse.
  const gordo = Buffer.alloc(51 * 1024 * 1024);
  await assert.doesNotReject(() => archivePdf({
    id: 'job-2', clientId: 'acme', kind: 'radar',
    periodKey: '2026-08', filename: 'gordo.pdf', pdf: gordo,
  }));
});

test('la ventana por defecto son 90 dias', () => {
  assert.equal(RETENCION_DIAS, 90);
});
