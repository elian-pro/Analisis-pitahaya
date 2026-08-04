import { test } from 'node:test';
import assert from 'node:assert';
import { humanizeError } from './humanizeError';

const CREDITO = (id: string) =>
  `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"${id}"}`;

test('saldo agotado: una sola causa y los asesores nombrados una vez', () => {
  const out = humanizeError(
    `Todos los asesores fallaron. Ana Paula Noble: ${CREDITO('a')} | Melisa Noble: ${CREDITO('b')} | Normig Zoghbi: ${CREDITO('c')}`,
  );
  assert.match(out, /créditos de la API de Anthropic/);
  assert.match(out, /Ana Paula Noble, Melisa Noble, Normig Zoghbi/);
  assert.doesNotMatch(out, /invalid_request_error|request_id/);
});

test('causas distintas: se listan por separado', () => {
  const out = humanizeError(
    `Todos los asesores fallaron. Ana: ${CREDITO('a')} | Beto: ETIMEDOUT connect`,
  );
  assert.match(out, /• Ana: .*créditos/);
  assert.match(out, /• Beto: .*conexión/);
});

test('error suelto sin patrón: se le quita el envoltorio JSON', () => {
  assert.strictEqual(
    humanizeError('400 {"type":"error","error":{"message":"Algo raro pasó"}}'),
    'Algo raro pasó',
  );
});

test('los mensajes propios del sistema pasan intactos y no se re-traducen', () => {
  const propio = 'El cliente no tiene asesores en el roster. Agrégalos en la pestaña Reportes.';
  assert.strictEqual(humanizeError(propio), propio);
  assert.strictEqual(humanizeError(humanizeError(CREDITO('a'))), humanizeError(CREDITO('a')));
});

test('vacío', () => assert.strictEqual(humanizeError(''), 'Error desconocido'));
