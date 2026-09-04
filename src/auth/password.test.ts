import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password';

test('el hash no contiene la contraseña y sigue el formato scrypt', () => {
  const h = hashPassword('correcto caballo bateria');
  assert.ok(!h.includes('correcto caballo bateria'));
  assert.match(h, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
});

test('verify acepta la contraseña correcta y rechaza la incorrecta', () => {
  const h = hashPassword('s3creta!');
  assert.equal(verifyPassword('s3creta!', h), true);
  assert.equal(verifyPassword('s3creta', h), false);
  assert.equal(verifyPassword('', h), false);
});

test('dos altas de la misma contraseña producen hashes distintos (salt real)', () => {
  assert.notEqual(hashPassword('igual'), hashPassword('igual'));
});

test('un hash con formato basura no lanza: devuelve false', () => {
  assert.equal(verifyPassword('x', 'no-es-un-hash'), false);
  assert.equal(verifyPassword('x', 'scrypt$mal$formado'), false);
  assert.equal(verifyPassword('x', ''), false);
});
