import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverSlug, puedeCaerAlRegistro } from './aislamiento';

// Las dos reglas que impiden que un cliente externo vea llamadas de otro.
// Se rompieron las dos a la vez y el síntoma fue ver Midstorage desde la vista
// de Cancun Country Club, así que quedan escritas aquí.

test('un cliente queda clavado a su cuenta, pida lo que pida', () => {
  const r = resolverSlug({ role: 'client', client_id: 'acme' }, 'midstorage');
  assert.equal(r.slug, 'acme');
});

test('un cliente NUNCA recibe la primera cuenta por defecto', () => {
  // Este es el fallo: sin slug, la ruta caía a listCuentasHabilitadas()[0],
  // que es la primera cuenta de Callpicker. Para alguien acotado a un tenant
  // eso es la cuenta de otro.
  const r = resolverSlug({ role: 'client', client_id: 'acme' }, undefined);
  assert.equal(r.slug, 'acme');
  assert.equal(r.permitirPrimera, false);
});

test('un cliente sin cuenta propia se queda sin nada, no con la de otro', () => {
  const r = resolverSlug({ role: 'client', client_id: '' }, undefined);
  assert.equal(r.permitirPrimera, false, 'jamás la primera para un tenant');
});

test('el admin sí puede pedir una cuenta concreta, y sin pedirla toma la primera', () => {
  assert.deepEqual(resolverSlug({ role: 'admin' }, 'midstorage'), { slug: 'midstorage', permitirPrimera: false });
  assert.deepEqual(resolverSlug({ role: 'admin' }, undefined),    { slug: undefined,    permitirPrimera: true });
});

test('sin sesión (auth desactivada) se comporta como admin', () => {
  assert.equal(resolverSlug(undefined, undefined).permitirPrimera, true);
});

test('el slug de un cliente externo no puede resolverse contra Callpicker', () => {
  // Si el cliente externo todavía no conectó su base, la respuesta correcta es
  // "no hay cuenta". Buscar ese slug en el registro de Callpicker abría la
  // puerta a que un slug coincidente le entregara llamadas ajenas.
  assert.equal(puedeCaerAlRegistro(true), false, 'externo: solo su propia base');
  assert.equal(puedeCaerAlRegistro(false), true, 'gestionado: el registro es su sitio');
});
