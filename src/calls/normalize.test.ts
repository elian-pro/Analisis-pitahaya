import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCall, evaluateCall, firstRecordUrl, eventDate, parseLooseDate,
} from './normalize';

// Fila real de la pestaña `outbound_call_completed` de Midstorage, con los 30
// campos que manda Callpicker recortados a los que se usan.
const EVENTO = {
  api_version: 2,
  created: 1784128770638,
  event: 'outbound_call_completed',
  call_id: 'o-153386267',
  call_attempt: 1,
  call_type: 'outbound',
  call_status: 'Redirected',
  call_source: 'api',
  date: '2026-7-15 9:18:39',
  callpicker_number: '529998680475',
  callpicker_description: 'ZD - Midstorage',
  callpicker_destination_name: 'Claudia Proclama',
  callee_number: '9993022130',
  callee_city: 'MERIDA',
  callee_state: 'YUC',
  wait_time: 2,
  duration: 1,
  duration_sec: 41,
  records: '["https://api.callpicker.com/call_details/getRecordAudio/CP.CU.164887.938f/2cb9dc35"]',
};

test('el asesor sale de callpicker_destination_name', () => {
  assert.equal(normalizeCall(EVENTO).asesor, 'Claudia Proclama');
});

test('el teléfono guardado es el del PROSPECTO, no la línea de la empresa', () => {
  // El bug que arrastran Midstorage y Gira: usan callpicker_number (529998680475),
  // que es la línea saliente propia, y por eso la búsqueda en Kommo nunca acierta.
  const c = normalizeCall(EVENTO);
  assert.equal(c.callee_number, '9993022130');
  assert.notEqual(c.callee_number, EVENTO.callpicker_number);
});

test('la fecha es la de la llamada, no la del procesamiento', () => {
  const c = normalizeCall(EVENTO);
  assert.equal(c.fecha.getTime(), 1784128770638);
  // Y coincide con el campo `date` legible que trae el mismo evento, que es lo
  // que confirma que `created` está en milisegundos y no en segundos.
  const legible = parseLooseDate(EVENTO.date)!;
  const difMin = Math.abs(c.fecha.getTime() - legible.getTime()) / 60000;
  assert.ok(difMin < 60, `created y date difieren ${difMin.toFixed(1)} min`);
});

test('sin created se cae al campo date, que no es ISO', () => {
  const { created, ...sinCreated } = EVENTO;
  const d = eventDate(sinCreated);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);   // julio, 0-indexed
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 18);
});

test('records se desenvuelve del string JSON', () => {
  assert.ok(normalizeCall(EVENTO).record?.startsWith('https://api.callpicker.com/'));
  assert.equal(firstRecordUrl('["https://a/x"]'), 'https://a/x');
  assert.equal(firstRecordUrl(['https://a/x']), 'https://a/x');   // ya parseado
  assert.equal(firstRecordUrl('[]'), null);
  assert.equal(firstRecordUrl(''), null);
  assert.equal(firstRecordUrl(undefined), null);
  assert.equal(firstRecordUrl('no-es-json'), null);
});

test('sin call_id se rechaza: sin identidad no hay idempotencia', () => {
  const { call_id, ...sinId } = EVENTO;
  assert.throws(() => normalizeCall(sinId), /call_id/);
});

test('el raw completo se conserva', () => {
  // 30 campos hoy; el día que alguien necesite callee_city o wait_time, están.
  assert.deepEqual(normalizeCall(EVENTO).raw, EVENTO);
});

test('una llamada corta se descarta, y descartar no es fallar', () => {
  const corta = normalizeCall(EVENTO);          // 41 s
  const r = evaluateCall(corta);
  assert.equal(r?.discard, true);
  assert.match(r!.reason, /41s < 90s/);
});

test('una llamada sin grabación se descarta', () => {
  const c = normalizeCall({ ...EVENTO, records: '[]', duration_sec: 300 });
  assert.match(evaluateCall(c)!.reason, /Sin grabación/);
});

test('una llamada larga con grabación pasa', () => {
  const c = normalizeCall({ ...EVENTO, duration_sec: 300 });
  assert.equal(evaluateCall(c), null);
});

test('el umbral es configurable por cliente', () => {
  const c = normalizeCall({ ...EVENTO, duration_sec: 95 });
  assert.equal(evaluateCall(c, 90), null);        // Midstorage
  assert.ok(evaluateCall(c, 100));                // Grupo Gira
  assert.equal(evaluateCall(c, 0), null);         // sin filtro
});

test('los campos ausentes no revientan la normalización', () => {
  const c = normalizeCall({ call_id: 'o-1' });
  assert.equal(c.asesor, '');
  assert.equal(c.callee_number, null);
  assert.equal(c.duracion_segundos, 0);
  assert.equal(c.record, null);
  assert.ok(c.fecha instanceof Date);
});
