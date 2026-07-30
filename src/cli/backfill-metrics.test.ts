import { test } from 'node:test';
import assert from 'node:assert/strict';

// El CLI arrastra config/env y config/db, que abortan sin credenciales.
process.env.GOOGLE_SA_JSON    ||= '{}';
process.env.ANTHROPIC_API_KEY ||= 'test';
const { parseSidecarName } = require('./backfill-metrics') as typeof import('./backfill-metrics');

test('separa asesor y periodo, mensual y semanal', () => {
  assert.deepEqual(parseSidecarName('Sidecar_Ana Lopez_2026-05.txt'),
    { advisor: 'Ana Lopez', periodKey: '2026-05' });
  assert.deepEqual(parseSidecarName('Sidecar_Ana Lopez_2026-05-05.txt'),
    { advisor: 'Ana Lopez', periodKey: '2026-05-05' });
});

test('el nombre del asesor puede traer guiones bajos y no se parte por ahí', () => {
  assert.deepEqual(parseSidecarName('Sidecar_Ana_Paula_Noble_2026-07-20.txt'),
    { advisor: 'Ana_Paula_Noble', periodKey: '2026-07-20' });
});

test('sin extension tambien vale, y lo que no encaja se descarta', () => {
  assert.deepEqual(parseSidecarName('Sidecar_Luis Paz_2026-07'),
    { advisor: 'Luis Paz', periodKey: '2026-07' });
  assert.equal(parseSidecarName('radar-2026-07.json'), null);
  assert.equal(parseSidecarName('Sidecar_Sin Periodo.txt'), null);
  assert.equal(parseSidecarName('Reporte_Ana_2026-05.txt'), null);
});
