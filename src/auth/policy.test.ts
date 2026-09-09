import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { POLITICAS, matchPolicy } from './policy';

// ─────────────────────────────────────────────────────────────────────────────
// Test de ARQUITECTURA (precedente: calls/config.test.ts). La política de
// autorización solo protege lo que clasifica: este test recorre las rutas
// reales montadas bajo /api y falla si alguna no tiene entrada en POLITICAS
// (y al revés: una entrada sin ruta real es un typo que dejaría un agujero).
// Agregar un endpoint nuevo OBLIGA a decidir su régimen aquí.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');

function discoverRoutes(): Set<string> {
  const server = readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

  // Montajes: app.use('/api/x', yRouter) + import yRouter from './routes/z'
  const importOf: Record<string, string> = {};
  for (const m of server.matchAll(/import (\w+) from '\.\/routes\/(\w+)'/g)) {
    importOf[m[1]] = m[2];
  }
  const mounts: Array<{ prefix: string; file: string }> = [];
  for (const m of server.matchAll(/app\.use\('(\/api[^']*)',\s*(\w+)\)/g)) {
    const file = importOf[m[2]];
    if (file) mounts.push({ prefix: m[1], file });
  }
  assert.ok(mounts.length >= 10, `se esperaban >=10 montajes /api, hay ${mounts.length}`);

  const routes = new Set<string>();
  for (const { prefix, file } of mounts) {
    const src = readFileSync(path.join(ROOT, 'routes', `${file}.ts`), 'utf8');
    for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']*)'/g)) {
      const sub = m[2] === '/' ? '' : m[2];
      routes.add(`${m[1].toUpperCase()} ${prefix}${sub}`);
    }
  }
  return routes;
}

test('arquitectura: toda ruta /api tiene politica, y toda politica tiene ruta', () => {
  const reales = discoverRoutes();
  const sinPolitica = [...reales].filter(r => !POLITICAS[r]);
  assert.deepEqual(
    sinPolitica, [],
    `Rutas sin clasificar en auth/policy.ts (sin entrada quedan admin-only de facto, ` +
    `pero la política DEBE ser explícita): ${sinPolitica.join(', ')}`,
  );
  const fantasma = Object.keys(POLITICAS).filter(k => !reales.has(k));
  assert.deepEqual(fantasma, [], `Entradas de POLITICAS sin ruta real (¿typo?): ${fantasma.join(', ')}`);
});

test('arquitectura: los routers /api se montan despues de requireApiAuth', () => {
  const server = readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  const guard = server.indexOf("app.use('/api', requireApiAuth)");
  assert.ok(guard > 0, 'falta el guard requireApiAuth');
  for (const m of server.matchAll(/app\.use\('(\/api\/[^']*)'/g)) {
    if (m[1] === '/api/health') continue; // healthcheck público, deliberado
    assert.ok(
      (m.index ?? 0) > guard,
      `${m[1]} está montado ANTES de requireApiAuth: quedaría sin autenticación`,
    );
  }
});

// ── matchPolicy: la resolución de patrones ───────────────────────────────────

test('matchPolicy: literal gana sobre parametro y captura params', () => {
  assert.equal(matchPolicy('GET', '/api/report/previous')?.entry.own, 'query');
  const m = matchPolicy('GET', '/api/report/abc-123');
  assert.equal(m?.entry.own, 'job');
  assert.equal(m?.params.jobId, 'abc-123');
});

// 'history' y ':jobId' son ambos de un segmento, y 'history/:id/download' tiene
// cinco frente a los cuatro de ':jobId/download'. Si el literal perdiera, el
// listado del archivo se leeria como un job inexistente y devolveria 404 sin que
// nada fallara ruidosamente: es el unico riesgo de enrutado silencioso que tiene
// esta funcion.
test('matchPolicy: el archivo no se confunde con un jobId', () => {
  assert.equal(matchPolicy('GET', '/api/report/history')?.entry.own, 'query');
  const doc = matchPolicy('GET', '/api/report/history/doc-1/download');
  assert.equal(doc?.entry.own, 'handler');
  assert.equal(doc?.params.id, 'doc-1');
  // Y la descarga por job sigue en su sitio.
  assert.equal(matchPolicy('GET', '/api/report/abc-123/download')?.entry.own, 'job');
});

test('matchPolicy: ruta desconocida devuelve null (default deny)', () => {
  assert.equal(matchPolicy('GET', '/api/inventada'), null);
  assert.equal(matchPolicy('DELETE', '/api/report/x/download'), null);
});

test('matchPolicy: sin sorpresas con slash final o params anidados', () => {
  assert.equal(matchPolicy('GET', '/api/clients/')?.entry.own, 'handler');
  const m = matchPolicy('GET', '/api/calls/mi-slug/llamada-9');
  assert.equal(m?.entry.own, 'handler');
  assert.equal(m?.params.slug, 'mi-slug');
  assert.equal(m?.params.call_id, 'llamada-9');
});
