import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressAllowed, errorDeConexion, clasificarFallo } from './tenant';

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
  assert.match(errorDeConexion(new Error('The server does not support SSL connections'), 'h', 5432), /sin SSL/);
  assert.equal(errorDeConexion(new Error('password authentication failed for user "x"'), 'h', 5432),
    'password authentication failed for user "x"');
  assert.ok(errorDeConexion(new AggregateError([], ''), 'h', 5432).length > 0);
});

// Cada fallo cae en SU paso y trae el arreglo: es lo que la tarjeta enseña para
// que nadie tenga que preguntar qué significa un error de Postgres.
test('clasificarFallo: paso correcto y arreglo para cada causa conocida', () => {
  const ctx = { host: 'db.c.com', port: 5433, database: 'ccc', ip: '194.163.45.121' };
  const pg = (code: string, msg = 'x') => Object.assign(new Error(msg), { code });
  const casos: Array<[unknown, string, RegExp]> = [
    [new Error("El host 'x' resuelve a una dirección interna (10.0.0.1) y no está permitido."), 'host', /pública/],
    [pg('ENOTFOUND'),   'host',         /bien escrito/],
    [pg('ECONNREFUSED'), 'puerto',      /listen_addresses/],
    [pg('ETIMEDOUT'),   'puerto',       /firewall.*194\.163\.45\.121/],
    [new Error('The server does not support SSL connections'), 'ssl', /sin SSL/],
    [pg('28P01'),       'credenciales', /mayúsculas/],
    [pg('3D000'),       'credenciales', /nombre exacto/],
    [pg('28000', 'no pg_hba.conf entry for host'), 'credenciales', /pg_hba\.conf.*194\.163\.45\.121/],
  ];
  for (const [e, paso, arreglo] of casos) {
    const f = clasificarFallo(e, ctx, 'permisos');
    assert.equal(f.id, paso, `${(e as Error).message || (e as { code: string }).code} → ${paso}`);
    assert.match(f.arreglo ?? '', arreglo);
  }
  assert.equal(clasificarFallo(new Error('The server does not support SSL connections'), ctx, 'ssl').codigo, 'ssl_no_soportado');
  // Sin IP conocida el arreglo sigue siendo legible, sin "null".
  assert.doesNotMatch(clasificarFallo(pg('ETIMEDOUT'), { ...ctx, ip: null }, 'puerto').arreglo ?? '', /null/);
  // Lo desconocido se queda en el paso que se estaba comprobando, con su texto.
  const raro = clasificarFallo(new Error('permission denied for database ccc'), ctx, 'permisos');
  assert.deepEqual([raro.id, raro.detalle], ['permisos', 'permission denied for database ccc']);
});
