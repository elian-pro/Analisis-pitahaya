import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressAllowed, errorDeConexion } from './tenant';

// Anti-SSRF: el cliente escribe host y puerto. Sin este filtro, la "base del
// cliente" puede apuntar a 127.0.0.1 o a un servicio interno de EasyPanel y
// convertir la feature en un proxy hacia la red privada de Zebra.

test('rechaza loopback, privadas y link-local (IPv4 e IPv6)', () => {
  for (const ip of [
    '127.0.0.1', '127.9.9.9', '0.0.0.0',
    '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.10',
    '169.254.169.254', // metadata de nube, el clásico del SSRF
    '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', // IPv4 mapeada en IPv6
  ]) {
    assert.equal(addressAllowed(ip), false, `${ip} debería rechazarse`);
  }
});

test('acepta direcciones publicas', () => {
  for (const ip of ['8.8.8.8', '34.72.10.2', '172.32.0.1', '2001:4860:4860::8888']) {
    assert.equal(addressAllowed(ip), true, `${ip} debería aceptarse`);
  }
});

// Un AggregateError (host con IPv4 + IPv6, todas rechazadas) trae el mensaje
// vacío: sin leer su código, la pantalla solo podía decir "HTTP 502".
test('errorDeConexion nunca devuelve vacío y nombra la causa', () => {
  const agg = Object.assign(new AggregateError([
    Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432'), { code: 'ECONNREFUSED' }),
  ], ''), { code: 'ECONNREFUSED' });
  assert.match(errorDeConexion(agg, 'db.cliente.com', 5432), /rechazó la conexión en db\.cliente\.com:5432/);

  assert.match(errorDeConexion(new Error('Connection terminated due to connection timeout'), 'h', 5432), /no respondió/);
  assert.match(errorDeConexion(Object.assign(new Error('getaddrinfo ENOTFOUND h'), { code: 'ENOTFOUND' }), 'h', 5432), /No existe el host h/);
  assert.match(errorDeConexion(new Error('The server does not support SSL connections'), 'h', 5432), /Desmarca SSL/);
  assert.equal(errorDeConexion(new Error('password authentication failed for user "x"'), 'h', 5432),
    'password authentication failed for user "x"');
  assert.ok(errorDeConexion(new AggregateError([], ''), 'h', 5432).length > 0);
});
