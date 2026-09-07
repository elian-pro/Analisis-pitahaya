import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfVault } from './vault';

test('leer NO consume: el visualizador no puede dejarte sin la descarga', () => {
  // Antes borraba al primer acceso. Con un visor delante eso significaba que
  // mirar el reporte te quitaba la posibilidad de bajarlo.
  const v = new PdfVault(() => 0);
  v.put('job1', Buffer.from('pdf'), 'reporte.pdf');
  for (let i = 0; i < 3; i++) {
    const hit = v.read('job1');
    assert.equal(hit?.filename, 'reporte.pdf');
    assert.equal(hit?.buf.toString(), 'pdf');
  }
});

test('expira por TTL aunque nadie lo haya leído', () => {
  let now = 0;
  const v = new PdfVault(() => now);
  v.put('j', Buffer.from('x'), 'x.pdf');
  now = 30 * 60 * 1000 + 1;
  assert.equal(v.read('j'), undefined);
});

test('un id que nunca existió devuelve undefined', () => {
  assert.equal(new PdfVault(() => 0).read('nope'), undefined);
});

test('al pasar el tope de entradas expulsa el más viejo', () => {
  let now = 0;
  const v = new PdfVault(() => now, { maxEntries: 2 });
  v.put('a', Buffer.from('1'), 'a.pdf'); now = 1;
  v.put('b', Buffer.from('2'), 'b.pdf'); now = 2;
  v.put('c', Buffer.from('3'), 'c.pdf');
  assert.equal(v.read('a'), undefined);
  assert.ok(v.read('b'));
  assert.ok(v.read('c'));
});

test('al pasar el tope de bytes también expulsa: el techo de memoria es real', () => {
  // Ahora TODOS los clientes pasan por el vault, no solo los externos, así que
  // contar entradas no basta: 20 reportes de 8 MB son 160 MB de proceso.
  const v = new PdfVault(() => 0, { maxBytes: 10 });
  v.put('a', Buffer.alloc(6), 'a.pdf');
  v.put('b', Buffer.alloc(6), 'b.pdf');   // 12 > 10 → sale 'a'
  assert.equal(v.read('a'), undefined);
  assert.ok(v.read('b'));
});

test('un PDF más grande que el tope entero no se guarda, y no vacía la guarda', () => {
  const v = new PdfVault(() => 0, { maxBytes: 10 });
  v.put('chico', Buffer.alloc(4), 'c.pdf');
  v.put('enorme', Buffer.alloc(999), 'e.pdf');
  assert.equal(v.read('enorme'), undefined, 'no cabe: no se guarda');
  assert.ok(v.read('chico'), 'y no se lleva por delante lo que sí cabía');
});
