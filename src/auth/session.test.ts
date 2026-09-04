import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToken, verifyToken } from './session';

// El token es la única fuente de identidad (sesión stateless): estos tests
// cubren el roundtrip con rol y la compatibilidad con cookies emitidas antes
// de que existieran roles (payload sin `role`).

test('roundtrip: un cliente conserva rol, client_id y version', () => {
  const tok = createToken({ email: 'ana@acme.com', name: 'Ana', role: 'client', client_id: 'acme_1', v: 3 });
  const u = verifyToken(tok);
  assert.ok(u);
  assert.equal(u.email, 'ana@acme.com');
  assert.equal(u.role, 'client');
  assert.equal(u.client_id, 'acme_1');
  assert.equal(u.v, 3);
});

test('roundtrip: un admin no arrastra client_id', () => {
  const u = verifyToken(createToken({ email: 'c@zebradigital.marketing', role: 'admin' }));
  assert.ok(u);
  assert.equal(u.role, 'admin');
  assert.equal(u.client_id, undefined);
});

test('cookie legada sin rol: dominio permitido se convierte en admin', () => {
  // Simula un token emitido por la versión anterior: payload sin `role`.
  const legacy = createToken({ email: 'c@zebradigital.marketing', role: 'admin' });
  const [body] = legacy.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  delete payload.role;
  const u = verifyToken(resign(payload));
  assert.ok(u);
  assert.equal(u.role, 'admin');
});

test('cookie legada sin rol de un dominio ajeno: sesion invalida', () => {
  const payload = { sub: 'x@gmail.com', name: '', exp: Date.now() + 60_000 };
  assert.equal(verifyToken(resign(payload)), null);
});

test('rol client sin client_id: sesion invalida', () => {
  const payload = { sub: 'x@acme.com', name: '', exp: Date.now() + 60_000, role: 'client' };
  assert.equal(verifyToken(resign(payload)), null);
});

test('firma alterada o token expirado: sesion invalida', () => {
  const tok = createToken({ email: 'c@zebradigital.marketing', role: 'admin' });
  assert.equal(verifyToken(tok.slice(0, -2) + 'xx'), null);

  const expired = resign({ sub: 'c@zebradigital.marketing', exp: Date.now() - 1, role: 'admin' });
  assert.equal(verifyToken(expired), null);
});

// Reproduce la firma del server (mismo secreto por defecto en tests) para poder
// fabricar payloads arbitrarios sin exponer sign() del módulo.
function resign(payload: unknown): string {
  const crypto = require('node:crypto');
  const { authConfig } = require('./config');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', authConfig.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
