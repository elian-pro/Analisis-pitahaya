import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// `_nextRunDate` vive en index.html (la SPA es un solo archivo). En vez de
// duplicar la lógica aquí, se extrae la función del HTML y se ejecuta: si
// alguien la cambia y rompe el cálculo, esta prueba falla. Es la contraparte de
// isDue() en runner.ts — las dos deben coincidir en qué día toca correr.
function loadNextRunDate(): (s: any) => string | null {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf-8');
  const start = html.indexOf('function _nextRunDate(s) {');
  assert.notStrictEqual(start, -1, '_nextRunDate ya no está en index.html');
  let depth = 0, i = html.indexOf('{', start);
  const from = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  const body = html.slice(from + 1, i);
  return new Function('s', body) as (s: any) => string | null;
}

const nextRunDate = loadNextRunDate();

// Jueves 30 de julio de 2026, 14:00 en America/Mexico_City (20:00 UTC).
const NOW = Date.parse('2026-07-30T20:00:00Z');
const RealDate = Date;
// `new Date()` sin argumentos devuelve el instante congelado; con argumentos se
// comporta normal (la función construye fechas de calendario y parsea ISO).
const FrozenDate = new Proxy(RealDate, {
  construct: (target, args) => args.length ? new (target as any)(...args) : new target(NOW),
});

function at(schedule: Record<string, unknown>): string | null {
  (globalThis as any).Date = FrozenDate;
  try { return nextRunDate({ enabled: true, hour: 10, minute: 0, timezone: 'America/Mexico_City', ...schedule }); }
  finally { (globalThis as any).Date = RealDate; }
}

test('_nextRunDate: siguiente día que toca según la frecuencia', () => {
  assert.strictEqual(at({ frequency: 'weekly',  day_of_week: 2 }),  '2026-08-04'); // martes
  assert.strictEqual(at({ frequency: 'weekly',  day_of_week: 5 }),  '2026-07-31'); // viernes: mañana
  assert.strictEqual(at({ frequency: 'monthly', day_of_month: 1 }), '2026-08-01');
  assert.strictEqual(at({ frequency: 'biweekly' }),                 '2026-08-01');
});

test('_nextRunDate: la hora de hoy ya pasó → se va al siguiente día', () => {
  assert.strictEqual(at({ frequency: 'daily', hour: 10 }), '2026-07-31'); // 10:00 < 14:00
  assert.strictEqual(at({ frequency: 'daily', hour: 18 }), '2026-07-30'); // todavía no son las 18:00
});

test('_nextRunDate: una corrida por día — si ya se disparó hoy, salta al siguiente', () => {
  assert.strictEqual(
    at({ frequency: 'daily', hour: 18, last_attempt: '2026-07-30T13:00:00Z' }), '2026-07-31');
  // Intento de ayer: no bloquea el de hoy.
  assert.strictEqual(
    at({ frequency: 'daily', hour: 18, last_attempt: '2026-07-29T13:00:00Z' }), '2026-07-30');
});

test('_nextRunDate: sin próxima ejecución', () => {
  assert.strictEqual(at({ frequency: 'daily', enabled: false }), null);
  assert.strictEqual(at({ frequency: 'once', run_date: '2026-07-01' }), null);
  assert.strictEqual(at({ frequency: 'once', run_date: '2026-09-15' }), '2026-09-15');
});

test('_nextRunDate: el día se juzga en la zona de la automatización, no la del navegador', () => {
  // 20:00 UTC del jueves ya es viernes en Tokio: ahí el próximo viernes es hoy.
  assert.strictEqual(
    at({ frequency: 'weekly', day_of_week: 5, hour: 23, timezone: 'Asia/Tokyo' }), '2026-07-31');
});
