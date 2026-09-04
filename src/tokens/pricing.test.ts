import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PRECIOS, costoUSD, providerOf } from './pricing';

test('cada modelo instrumentado tiene tarifa y proveedor', () => {
  for (const model of ['claude-sonnet-4-6', 'gemini-3.5-flash', 'gpt-4o-mini']) {
    assert.ok(PRECIOS[model], `falta tarifa de ${model}`);
    assert.ok(costoUSD(model, 1e6, 1e6) > 0);
    assert.notEqual(providerOf(model), 'desconocido');
  }
});

test('modelo desconocido no lanza: cuesta 0', () => {
  assert.equal(costoUSD('modelo-inventado', 5e6, 5e6), 0);
  assert.equal(providerOf('modelo-inventado'), 'desconocido');
});

test('la tarifa de claude coincide con lo que siempre se cobro (3/15)', () => {
  assert.equal(costoUSD('claude-sonnet-4-6', 1e6, 0), 3.0);
  assert.equal(costoUSD('claude-sonnet-4-6', 0, 1e6), 15.0);
});

// Test de arquitectura: nadie vuelve a hardcodear tarifas fuera de este módulo.
// La duplicación exacta que existía entre tokens/store.ts y jobs/runner.ts.
test('arquitectura: ninguna tarifa hardcodeada fuera de tokens/pricing.ts', () => {
  const root = path.join(__dirname, '..');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts') || p.endsWith('.test.ts')) continue;
      if (p.endsWith(`tokens${path.sep}pricing.ts`)) continue;
      const src = readFileSync(p, 'utf8');
      // El patrón de la tarifa inline: "/ 1e6) * <numero>"
      if (/\/\s*1e6\)\s*\*\s*\d/.test(src)) offenders.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `Tarifas inline fuera de pricing.ts: ${offenders.join(', ')}`);
});
