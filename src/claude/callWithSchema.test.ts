import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callWithSchema, type ClaudeReply } from './callWithSchema';

const Schema = z.object({ tendencia: z.enum(['mejora', 'baja', 'estable']) });

const reply = (input: unknown, tokens = 10): ClaudeReply => ({
  content: [{ type: 'tool_use', id: 'tu_1', name: 'r', input }],
  usage: { input_tokens: tokens, output_tokens: tokens },
});

test('a la primera válida, devuelve los datos sin reintentar', async () => {
  const enviados: unknown[][] = [];
  const r = await callWithSchema({
    schema: Schema, tag: 't',
    send: async (messages) => { enviados.push(messages); return reply({ tendencia: 'mejora' }); },
  });
  assert.deepEqual(r.data, { tendencia: 'mejora' });
  assert.equal(enviados.length, 1);
  assert.equal(r.input_tokens, 10);
});

test('tras un fallo de validación, el reintento LLEVA el error de vuelta', async () => {
  const enviados: any[][] = [];
  const r = await callWithSchema({
    schema: Schema, tag: 't',
    send: async (messages) => {
      enviados.push(messages as any[]);
      // El error real de producción: 'mixto' es válido para el campo hermano.
      return reply(enviados.length === 1 ? { tendencia: 'mixto' } : { tendencia: 'estable' });
    },
  });
  assert.deepEqual(r.data, { tendencia: 'estable' });
  assert.equal(enviados.length, 2);

  // El segundo intento no repite la misma petición: arrastra la respuesta
  // rechazada y un tool_result con el motivo. Sin esto, los 3 intentos son
  // idénticos y el job muere repitiendo el mismo error.
  const segundo = enviados[1];
  assert.equal(segundo.length, 3, 'debe llevar user + assistant + tool_result');
  const ultimo = segundo[2];
  assert.equal(ultimo.role, 'user');
  assert.equal(ultimo.content[0].type, 'tool_result');
  assert.equal(ultimo.content[0].is_error, true);
  assert.equal(ultimo.content[0].tool_use_id, 'tu_1');
  assert.match(ultimo.content[0].content, /tendencia/);
  assert.match(ultimo.content[0].content, /mixto/);
});

test('los tokens se acumulan a través de los reintentos', async () => {
  let n = 0;
  const r = await callWithSchema({
    schema: Schema, tag: 't',
    send: async () => { n++; return reply(n === 1 ? { tendencia: 'nope' } : { tendencia: 'baja' }, 7); },
  });
  assert.equal(r.input_tokens, 14);   // lo rechazado también se pagó
  assert.equal(r.output_tokens, 14);
});

test('agotados los intentos, lanza el último error', async () => {
  let n = 0;
  await assert.rejects(
    () => callWithSchema({
      schema: Schema, tag: 't', maxRetries: 2,
      send: async () => { n++; return reply({ tendencia: 'mixto' }); },
    }),
    /tendencia/,
  );
  assert.equal(n, 2);
});

test('una respuesta sin tool_use no rompe el bucle de feedback', async () => {
  let n = 0;
  const r = await callWithSchema({
    schema: Schema, tag: 't',
    send: async () => {
      n++;
      if (n === 1) return { content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 1, output_tokens: 1 } };
      return reply({ tendencia: 'mejora' });
    },
  });
  assert.deepEqual(r.data, { tendencia: 'mejora' });
});
