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

// Con las dos variables puestas y quitadas a mano: cada test deja el entorno
// como lo encontró.
function conEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const prev = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { fn(); } finally {
    for (const [k, v] of Object.entries(prev)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test('formato invalido lanza con mensaje claro, y sin ninguna clave tambien', () => {
  assert.throws(() => decryptSecret('no-es-un-blob'), /formato/i);
  conEnv({ TENANT_DB_SECRET: undefined, AUTH_SESSION_SECRET: undefined }, () => {
    assert.throws(() => encryptSecret('x'), /AUTH_SESSION_SECRET/);
  });
});

// Conectar la base de un cliente no puede exigir tocar EasyPanel: sin
// TENANT_DB_SECRET la clave sale de AUTH_SESSION_SECRET, que ya existe.
test('sin TENANT_DB_SECRET deriva la clave de AUTH_SESSION_SECRET, estable', () => {
  conEnv({ TENANT_DB_SECRET: undefined, AUTH_SESSION_SECRET: 'sesion-de-prueba' }, () => {
    const enc = encryptSecret('clave-cliente');
    assert.equal(decryptSecret(enc), 'clave-cliente');   // misma clave al leer
  });
  // Otra AUTH_SESSION_SECRET ya no la abre: es el coste documentado de rotarla.
  let enc = '';
  conEnv({ TENANT_DB_SECRET: undefined, AUTH_SESSION_SECRET: 'una' }, () => { enc = encryptSecret('x'); });
  conEnv({ TENANT_DB_SECRET: undefined, AUTH_SESSION_SECRET: 'otra' }, () => {
    assert.throws(() => decryptSecret(enc));
  });
});

test('TENANT_DB_SECRET tiene prioridad sobre la derivada', () => {
  let enc = '';
  conEnv({ TENANT_DB_SECRET: 'c'.repeat(64), AUTH_SESSION_SECRET: 'una' }, () => { enc = encryptSecret('x'); });
  conEnv({ TENANT_DB_SECRET: 'c'.repeat(64), AUTH_SESSION_SECRET: 'otra' }, () => {
    assert.equal(decryptSecret(enc), 'x');   // la sesión no influye si hay clave propia
  });
});
