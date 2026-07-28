import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureClientFolders, type ClientConfig } from './manager';

// Falso Drive: registra qué se pidió crear y devuelve un ID predecible.
function fakeMkdir(calls: string[][]) {
  return async (parentId: string, name: string) => {
    calls.push([parentId, name]);
    return `id_${name}`;
  };
}

test('crea la carpeta del cliente y la de Radar en la ubicación elegida', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia Fractional', parent_folder_id: 'UNIDAD' } as Partial<ClientConfig>,
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, [['UNIDAD', 'Sofia Fractional'], ['id_Sofia Fractional', 'Radar']]);
  assert.equal(out.folder_id, 'id_Sofia Fractional');
  assert.equal(out.radar_folder_id, 'id_Radar');
});

test('no toca Drive si ya hay carpeta de reportes (link pegado o cliente existente)', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD', folder_id: 'YA_EXISTE' },
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, []);
  assert.equal(out.folder_id, 'YA_EXISTE');
});

test('respeta una carpeta de Radar ya configurada', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD', radar_folder_id: 'RADAR_MANUAL' },
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, [['UNIDAD', 'Sofia']]);
  assert.equal(out.radar_folder_id, 'RADAR_MANUAL');
});

test('sin ubicación elegida no crea nada', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders({ name: 'Sofia' } as Partial<ClientConfig>, fakeMkdir(calls));
  assert.deepEqual(calls, []);
  assert.equal(out.folder_id, undefined);
});
