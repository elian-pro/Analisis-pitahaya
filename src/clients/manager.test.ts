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

const REPORTES = 'Sofia | Analisis de llamadas IA';
const RADAR    = 'Sofia | Radar de Objeciones IA';

test('por defecto crea ambas carpetas, lado a lado en la ubicación', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD' } as Partial<ClientConfig>,
    {},
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, [['UNIDAD', REPORTES], ['UNIDAD', RADAR]]);
  assert.equal(out.folder_id, 'id_' + REPORTES);
  assert.equal(out.radar_folder_id, 'id_' + RADAR);
});

test('cliente que ya tiene análisis: crea solo la de Radar', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD', folder_id: 'YA_EXISTE' } as Partial<ClientConfig>,
    {},
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, [['UNIDAD', RADAR]]);
  assert.equal(out.folder_id, 'YA_EXISTE');       // no se toca
  assert.equal(out.radar_folder_id, 'id_' + RADAR);
});

test('solo Radar desmarcado: crea únicamente la de reportes', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD' } as Partial<ClientConfig>,
    { radar: false },
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, [['UNIDAD', REPORTES]]);
  assert.equal(out.radar_folder_id, undefined);
});

test('solo reportes desmarcado: crea únicamente la de Radar', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD' } as Partial<ClientConfig>,
    { reports: false },
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, [['UNIDAD', RADAR]]);
  assert.equal(out.folder_id, undefined);
});

test('ambas desmarcadas: no toca Drive', async () => {
  const calls: string[][] = [];
  await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD' } as Partial<ClientConfig>,
    { reports: false, radar: false },
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, []);
});

test('respeta carpetas ya configuradas aunque estén marcadas', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders(
    { name: 'Sofia', parent_folder_id: 'UNIDAD', folder_id: 'A', radar_folder_id: 'B' } as Partial<ClientConfig>,
    {},
    fakeMkdir(calls),
  );
  assert.deepEqual(calls, []);
  assert.equal(out.folder_id, 'A');
  assert.equal(out.radar_folder_id, 'B');
});

test('sin ubicación elegida no crea nada', async () => {
  const calls: string[][] = [];
  const out = await ensureClientFolders({ name: 'Sofia' } as Partial<ClientConfig>, {}, fakeMkdir(calls));
  assert.deepEqual(calls, []);
  assert.equal(out.folder_id, undefined);
});
