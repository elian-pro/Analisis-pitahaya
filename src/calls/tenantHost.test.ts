import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressAllowed } from './tenant';

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
