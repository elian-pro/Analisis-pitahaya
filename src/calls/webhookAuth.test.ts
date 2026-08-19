import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWebhookToken, tokensMatch, extractToken } from './webhookAuth';

test('el token correcto pasa', () => {
  assert.deepEqual(checkWebhookToken('s3cr3t', 's3cr3t'), { ok: true });
});

test('un token equivocado se rechaza con 401', () => {
  const r = checkWebhookToken('otro', 's3cr3t');
  assert.equal(r.ok, false);
  assert.equal((r as any).status, 401);
});

test('sin token se rechaza con 401', () => {
  assert.equal((checkWebhookToken(undefined, 's3cr3t') as any).status, 401);
  assert.equal((checkWebhookToken('', 's3cr3t') as any).status, 401);
});

test('sin configurar responde 503, no 401', () => {
  // La diferencia importa: 401 dice "tu token está mal" y manda a revisar
  // Callpicker; 503 dice "falta configurar el servidor", que es lo que pasa.
  const r = checkWebhookToken('lo-que-sea', undefined);
  assert.equal((r as any).status, 503);
  assert.match((r as any).error, /CALLS_WEBHOOK_TOKEN/);
});

test('la comparación no revienta con longitudes distintas', () => {
  // timingSafeEqual lanza si los buffers difieren en tamaño; comparar digests
  // lo evita. Sin esto, un token corto tumbaría el endpoint en vez de rechazar.
  assert.doesNotThrow(() => tokensMatch('a', 'un-secreto-larguísimo'));
  assert.equal(tokensMatch('a', 'un-secreto-larguísimo'), false);
  assert.equal(tokensMatch('igual', 'igual'), true);
});

test('el token se acepta por cabecera o por query', () => {
  assert.equal(extractToken({ 'x-webhook-token': 'abc' }, {}), 'abc');
  assert.equal(extractToken({}, { token: 'abc' }), 'abc');
  assert.equal(extractToken({ 'x-webhook-token': 'header' }, { token: 'query' }), 'header');
  assert.equal(extractToken({}, {}), undefined);
  assert.equal(extractToken({ 'x-webhook-token': '' }, {}), undefined);
});
