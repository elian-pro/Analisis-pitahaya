import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMetrics } from './aggregate';

// Las filas semanales del cliente (period_start = lunes) tienen que poder
// agruparse en meses y trimestres: es lo que hace que un cliente que solo
// genera reportes semanales vea algo en el Dashboard, en vez de nada.
const SEMANALES = [
  { advisor: 'Ana',  period_key: '2026-06-29', period_start: '2026-06-29', avg_score: 80, pct_siguiente: 50, talk_ratio: 40 },
  { advisor: 'Ana',  period_key: '2026-07-06', period_start: '2026-07-06', avg_score: 90, pct_siguiente: 60, talk_ratio: 45 },
  { advisor: 'Ana',  period_key: '2026-07-20', period_start: '2026-07-20', avg_score: 70, pct_siguiente: 40, talk_ratio: 35 },
  { advisor: 'Luis', period_key: '2026-07-06', period_start: '2026-07-06', avg_score: 60, pct_siguiente: 30, talk_ratio: 55 },
];

test('semanal: un punto por semana con datos', () => {
  const out = aggregateMetrics(SEMANALES, 'weekly');
  assert.equal(out.buckets.length, 3);
  assert.deepEqual(out.advisors, ['Ana', 'Luis']);
});

test('mensual: las semanas caen en su mes, y el 29 de junio no se cuela en julio', () => {
  const out = aggregateMetrics(SEMANALES, 'monthly');
  assert.deepEqual(out.buckets.map(b => b.key), ['2026-06', '2026-07']);
  const junio = out.team.find(p => p.bucket === '2026-06')!;
  const julio = out.team.find(p => p.bucket === '2026-07')!;
  assert.equal(junio.avg_score, 80);            // solo la semana del 29 de junio
  assert.equal(julio.avg_score, 73.33);   // redondeado a 2 decimales por aggregate.ts
});

test('trimestral: la semana de junio es Q2 y las de julio Q3, no se mezclan', () => {
  const out = aggregateMetrics(SEMANALES, 'quarterly');
  assert.equal(out.buckets.length, 2);
  assert.equal(out.team[0].avg_score, 80);                      // Q2: solo la del 29 de junio
  assert.equal(out.team[1].avg_score, 73.33);                   // Q3: las tres de julio
});

test('sin filas no revienta: devuelve vacío', () => {
  const out = aggregateMetrics([], 'monthly');
  assert.deepEqual(out.buckets, []);
  assert.deepEqual(out.advisors, []);
});
