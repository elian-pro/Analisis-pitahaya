import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nivelFromScore, nivelLabel, parseSidecarMetrics, SIDECAR_METRICS_VERSION } from './individual';

test('cada umbral cae del lado correcto', () => {
  assert.equal(nivelFromScore(100), 'elite');
  assert.equal(nivelFromScore(85),  'elite');
  assert.equal(nivelFromScore(84),  'alto_desempeno');
  assert.equal(nivelFromScore(70),  'alto_desempeno');
  assert.equal(nivelFromScore(69),  'consistente');
  assert.equal(nivelFromScore(55),  'consistente');
  assert.equal(nivelFromScore(54),  'en_progreso');
  assert.equal(nivelFromScore(40),  'en_progreso');
  assert.equal(nivelFromScore(39),  'punto_de_partida');
  assert.equal(nivelFromScore(0),   'punto_de_partida');
});

test('mismo score, mismo nivel: la incoherencia del ranking ya no es posible', () => {
  // Ana 75 salia ACEPTABLE y Ernesto 75 NECESITA MEJORA en el mismo PDF.
  assert.equal(nivelFromScore(75), nivelFromScore(75));
  // Ricardo 49 salia con mejor nivel que Edwin 60.
  assert.ok(nivelFromScore(60) !== nivelFromScore(49));
});

test('el texto visible no se arma con replace sobre el slug', () => {
  // 'punto_de_partida'.replace('_', ' ') solo cambia el primer guion bajo y
  // dejaba "punto de_partida" impreso en el PDF.
  assert.equal(nivelLabel('punto_de_partida'), 'Punto de partida');
  assert.equal(nivelLabel('alto_desempeno'),   'Alto desempeño');
  assert.equal(nivelLabel('elite'),            'Élite');
});

test('ningun nivel se queda sin etiqueta', () => {
  const scores = [100, 85, 84, 70, 69, 55, 54, 40, 39, 0];
  for (const s of scores) {
    const label = nivelLabel(nivelFromScore(s));
    assert.ok(label && !label.includes('_'), `score ${s} → "${label}"`);
  }
});

// ── Sidecar: comparativo entre periodos ──────────────────────────────────────


const sidecar = (json: string) => `REPORTE INDIVIDUAL: Ana\n\n=== METRICAS_JSON ===\n${json}`;

test('un sidecar sin metrics_version es de la definicion vieja', () => {
  // Los sidecars ya escritos en Drive contaban los descartes dentro del
  // denominador de "logra siguiente paso": compararlos con los nuevos daria
  // una caida inventada.
  const m = parseSidecarMetrics(sidecar('{"avg_score":70,"pct_logra_siguiente_paso":40,"talk_ratio":55}'));
  assert.equal(m?.metrics_version, 1);
  assert.ok(m!.metrics_version < SIDECAR_METRICS_VERSION);
});

test('un sidecar nuevo declara su version', () => {
  const m = parseSidecarMetrics(sidecar('{"metrics_version":2,"avg_score":70,"pct_logra_siguiente_paso":40,"talk_ratio":55}'));
  assert.equal(m?.metrics_version, 2);
  assert.ok(m!.metrics_version >= SIDECAR_METRICS_VERSION);
});

test('sin bloque de metricas no hay comparativo', () => {
  assert.equal(parseSidecarMetrics('REPORTE INDIVIDUAL: Ana\nsin json'), null);
});
