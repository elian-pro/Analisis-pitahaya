import { test } from 'node:test';
import assert from 'node:assert/strict';

// La clave se lee de la env al usar (no al importar): fijarla antes del require
// tardío, patrón de backfill-metrics.test.ts.
process.env.TENANT_DB_SECRET = 'a'.repeat(64);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encryptSecret, decryptSecret } = require('./secrets');

test('roundtrip y formato versionado', () => {
  const enc = encryptSecret('p@ssw0rd:con/todo');
  assert.match(enc, /^v1\./);
  assert.ok(!enc.includes('p@ssw0rd'));
  assert.equal(decryptSecret(enc), 'p@ssw0rd:con/todo');
});

test('dos cifrados del mismo valor difieren (IV aleatorio)', () => {
  assert.notEqual(encryptSecret('igual'), encryptSecret('igual'));
});

test('alterar un byte rompe el descifrado (tag GCM)', () => {
  const enc = encryptSecret('secreto');
  const roto = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => decryptSecret(roto));
});

test('clave distinta no descifra', () => {
  const enc = encryptSecret('secreto');
  process.env.TENANT_DB_SECRET = 'b'.repeat(64);
  assert.throws(() => decryptSecret(enc));
  process.env.TENANT_DB_SECRET = 'a'.repeat(64);
});

test('formato invalido lanza con mensaje claro, y sin clave tambien', () => {
  assert.throws(() => decryptSecret('no-es-un-blob'), /formato/i);
  const prev = process.env.TENANT_DB_SECRET;
  delete process.env.TENANT_DB_SECRET;
  assert.throws(() => encryptSecret('x'), /TENANT_DB_SECRET/);
  process.env.TENANT_DB_SECRET = prev;
});
