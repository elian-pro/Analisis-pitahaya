import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTranscriptionPrompt, resolveAnalysisPrompt,
  DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_ANALYSIS_PROMPT,
} from './prompts';

test('los defaults no arrastran la identidad de ningún cliente', () => {
  // El bug del flujo de Grupo Gira: heredó el prompt de Midstorage completo y
  // durante un mes analizó sus llamadas como si vendiera bodegas en Umán.
  for (const p of [DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_ANALYSIS_PROMPT]) {
    for (const marca of ['Midstorage', 'GOBA', 'Umán', 'bodega', 'Linmex', 'agricultura', 'Alquimia']) {
      assert.ok(!p.toLowerCase().includes(marca.toLowerCase()), `el default menciona "${marca}"`);
    }
  }
});

test('el contexto del negocio se inyecta en el placeholder', () => {
  const p = resolveTranscriptionPrompt(null, 'Vende bodegas industriales en Umán.');
  assert.ok(p.includes('Vende bodegas industriales en Umán.'));
  assert.ok(!p.includes('{contexto}'));
});

test('sin contexto queda una frase explícita, no el placeholder crudo', () => {
  const p = resolveTranscriptionPrompt(null, undefined);
  assert.ok(!p.includes('{contexto}'));
  assert.match(p, /No se proporcionó contexto/);
  assert.equal(resolveTranscriptionPrompt(null, '   '), p);   // vacío = ausente
});

test('un cliente puede sustituir el prompt entero', () => {
  const propio = 'Mi prompt para {contexto}.';
  assert.equal(resolveTranscriptionPrompt(propio, 'ACME'), 'Mi prompt para ACME.');
  assert.equal(resolveAnalysisPrompt(propio, 'ACME'), 'Mi prompt para ACME.');
});

test('un prompt propio sin placeholder se respeta tal cual', () => {
  assert.equal(resolveTranscriptionPrompt('Literal, sin huecos.', 'ACME'), 'Literal, sin huecos.');
});

test('un prompt vacío cae al default', () => {
  assert.equal(resolveTranscriptionPrompt('', 'X'), resolveTranscriptionPrompt(null, 'X'));
  assert.equal(resolveTranscriptionPrompt('   ', 'X'), resolveTranscriptionPrompt(null, 'X'));
});

test('el prompt de transcripción conserva las reglas que importan', () => {
  const p = DEFAULT_TRANSCRIPTION_PROMPT;
  assert.match(p, /buzón de voz/i);              // detección de contestadora
  assert.match(p, /una sola línea/i);            // salida sin saltos
  assert.match(p, /\[TONO_CORDIAL\]/);           // marcadores paralingüísticos
  assert.match(p, /\[EMOCIÓN_CONFIANZA\]/);
});

test('el prompt de análisis conserva el contrato de salida', () => {
  const p = DEFAULT_ANALYSIS_PROMPT;
  for (const campo of ['TIPO_CONTACTO', 'PRESENTACION', 'PRECALIFICACION',
                       'EXPLORACION', 'AGENDAMIENTO', 'RESUMEN']) {
    assert.ok(p.includes(campo), `falta ${campo} en el prompt`);
  }
});
