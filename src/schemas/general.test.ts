import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ClaudeGeneralOutputSchema } from './general';

const base = {
  resumen_ejecutivo: 'ok',
  tendencia_equipo: 'mixto' as const,
  fortalezas_equipo: ['a'],
  areas_oportunidad: ['b'],
  mejores_practicas: [],
  patrones_objeciones: [],
  recomendaciones: [{ prioridad: 'alta', area: 'x', descripcion: 'y', dirigido_a: 'z' }],
};
const conTendencia = (t: string) => ({
  ...base,
  kpi_bullets: [{ label: 'Score equipo', valor: '72', tendencia: t }],
});

test("un KPI de equipo admite 'mixto': unos asesores suben y otros bajan", () => {
  // El fallo real en producción (Midstorage, semana 31 ago–06 sep 2026): el
  // modelo puso 'mixto' en un bullet porque tendencia_equipo sí lo acepta, y
  // los tres reintentos repitieron el error.
  assert.equal(ClaudeGeneralOutputSchema.safeParse(conTendencia('mixto')).success, true);
});

test('los cuatro valores previos siguen siendo válidos', () => {
  for (const t of ['mejora', 'baja', 'estable', 'sin_dato']) {
    assert.equal(ClaudeGeneralOutputSchema.safeParse(conTendencia(t)).success, true, t);
  }
});

test('lo que NO es de este campo se sigue rechazando', () => {
  // 'retroceso' y 'primer_mes' son de tendencia_equipo: aceptarlos aquí
  // escondería el desalineo en vez de arreglarlo.
  for (const t of ['retroceso', 'primer_mes', 'inventado']) {
    assert.equal(ClaudeGeneralOutputSchema.safeParse(conTendencia(t)).success, false, t);
  }
});

// Test de arquitectura: el vocabulario vive en cuatro sitios (zod, el esquema
// JSON que ve el modelo, el prompt y la plantilla). Si se separan, el modelo
// responde algo que la validación rechaza — que es exactamente lo que pasó.
test('arquitectura: el enum de zod y el que ve el modelo coinciden', () => {
  const src = readFileSync(path.join(__dirname, '..', 'claude', 'general.ts'), 'utf8');
  const m = src.match(/tendencia:\s*\{\s*type:\s*'string',\s*enum:\s*\[([^\]]+)\]/);
  assert.ok(m, 'no se encontró el enum de tendencia en el tool schema');
  const delModelo = m[1].split(',').map(s => s.trim().replace(/'/g, '')).sort();

  const zodSrc = readFileSync(path.join(__dirname, 'general.ts'), 'utf8');
  const z = zodSrc.match(/tendencia:\s*z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(z, 'no se encontró el enum de tendencia en el schema zod');
  const deZod = z[1].split(',').map(s => s.trim().replace(/'/g, '')).sort();

  assert.deepEqual(delModelo, deZod,
    'El enum que ve el modelo y el que valida zod se separaron: el modelo responderá algo que el parser rechaza.');
});

test('arquitectura: la plantilla sabe pintar todos los valores del enum', () => {
  const eta = readFileSync(path.join(__dirname, '..', 'pdf', 'templates', 'general.eta'), 'utf8');
  const arrow = eta.match(/const arrowChar[^\n]+/);
  assert.ok(arrow);
  // 'sin_dato' cae al fallback '·' a propósito; el resto necesita su símbolo.
  for (const t of ['mejora', 'baja', 'estable', 'mixto']) {
    assert.ok(arrow[0].includes(`'${t}'`), `arrowChar no contempla '${t}'`);
  }
});
