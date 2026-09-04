import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfVault } from './vault';

test('entrega una vez y borra: la segunda lectura no existe', () => {
  const v = new PdfVault(() => 0);
  v.put('job1', Buffer.from('pdf'), 'reporte.pdf');
  const hit = v.take('job1');
  assert.equal(hit?.filename, 'reporte.pdf');
  assert.equal(hit?.buf.toString(), 'pdf');
  assert.equal(v.take('job1'), undefined);
});

test('expira por TTL sin que nadie lo pida', () => {
  let now = 0;
  const v = new PdfVault(() => now);
  v.put('j', Buffer.from('x'), 'x.pdf');
  now = 30 * 60 * 1000 + 1;
  assert.equal(v.take('j'), undefined);
});

test('al pasar el tope expulsa el mas viejo', () => {
  let now = 0;
  const v = new PdfVault(() => now, { maxEntries: 2 });
  v.put('a', Buffer.from('1'), 'a.pdf'); now = 1;
  v.put('b', Buffer.from('2'), 'b.pdf'); now = 2;
  v.put('c', Buffer.from('3'), 'c.pdf');
  assert.equal(v.take('a'), undefined);
  assert.ok(v.take('b'));
  assert.ok(v.take('c'));
});
