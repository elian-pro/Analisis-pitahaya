import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INDIVIDUAL_PROMPT, DEFAULT_GENERAL_PROMPT, DEFAULT_RADAR_PROMPT,
  CALIFICACION_INSTRUCTION, NO_DASH_INSTRUCTION,
  resolveIndividualPrompt, resolveGeneralPrompt, resolveRadarPrompt,
} from './prompts';

const ESQUELETOS = [
  ['individual', DEFAULT_INDIVIDUAL_PROMPT],
  ['general',    DEFAULT_GENERAL_PROMPT],
  ['radar',      DEFAULT_RADAR_PROMPT],
] as const;

const RESOLVERS = [
  ['individual', resolveIndividualPrompt, DEFAULT_INDIVIDUAL_PROMPT],
  ['general',    resolveGeneralPrompt,    DEFAULT_GENERAL_PROMPT],
  ['radar',      resolveRadarPrompt,      DEFAULT_RADAR_PROMPT],
] as const;

test('ningun esqueleto arrastra la identidad de un cliente', () => {
  // El incidente que motivó todo esto: el flujo de Grupo Gira analizó sus
  // llamadas con el contexto de Midstorage porque alguien copió el prompt.
  const MARCAS = ['Midstorage', 'GOBA', 'Umán', 'Uman', 'bodegas?', 'Pitahaya', 'Aristea',
                  'Sof[ií]a', 'Gira', 'Alquimia', 'Acalai', 'Aston', 'fly and buy',
                  'Linmex', 'Tulum', 'Yucat[aá]n'];
  for (const [nombre, p] of ESQUELETOS) {
    for (const m of MARCAS) {
      // Con límites de palabra: sin ellos, "conexion humana" cazaba "Uman" y
      // el test fallaba por su propia imprecisión, no por el prompt.
      assert.ok(!new RegExp(`\\b${m}\\b`, 'i').test(p),
        `el esqueleto ${nombre} menciona "${m}"`);
    }
  }
});

test('los tres esqueletos tienen el hueco del contexto', () => {
  for (const [nombre, p] of ESQUELETOS) {
    assert.ok(p.includes('{contexto}'), `${nombre} no tiene {contexto}`);
  }
});

test('el contexto se inyecta donde toca', () => {
  for (const [nombre, resolver] of RESOLVERS) {
    const out = resolver(null, 'Vende bodegas industriales en Umán.');
    assert.ok(out.includes('Vende bodegas industriales en Umán.'), `${nombre} no inyectó`);
    assert.ok(!out.includes('{contexto}'), `${nombre} dejó el placeholder crudo`);
  }
});

test('sin contexto queda una frase explicita, nunca el placeholder', () => {
  for (const [nombre, resolver] of RESOLVERS) {
    const out = resolver(null, undefined);
    assert.ok(!out.includes('{contexto}'), `${nombre} dejó el placeholder`);
    assert.match(out, /No se proporciono contexto/, `${nombre} sin frase de respaldo`);
    assert.equal(resolver(null, '   '), out, `${nombre}: contexto en blanco != ausente`);
  }
});

test('un prompt propio sustituye al esqueleto', () => {
  for (const [nombre, resolver] of RESOLVERS) {
    assert.equal(resolver('Mi prompt para {contexto}.', 'ACME'), 'Mi prompt para ACME.', nombre);
  }
});

test('un prompt propio SIN placeholder se respeta tal cual', () => {
  // Su contexto ya vive dentro; inyectarlo otra vez lo duplicaría.
  for (const [nombre, resolver] of RESOLVERS) {
    assert.equal(resolver('Literal, sin huecos.', 'ACME'), 'Literal, sin huecos.', nombre);
  }
});

test('un prompt vacio o en blanco cae al esqueleto', () => {
  for (const [nombre, resolver, base] of RESOLVERS) {
    assert.equal(resolver('', 'X'),    resolver(null, 'X'), nombre);
    assert.equal(resolver('   ', 'X'), resolver(null, 'X'), nombre);
    assert.ok(resolver('', 'X').startsWith(base.slice(0, 40)), nombre);
  }
});

test('las reglas concatenadas NO estan dentro de los esqueletos', () => {
  // Van aparte para que sigan aplicando cuando un cliente usa su propio prompt.
  // Si alguien las mete dentro, saldrían dos veces en el mismo system y el
  // primer override las perdería.
  for (const [nombre, p] of ESQUELETOS) {
    assert.ok(!p.includes('descartado_no_califica'), `${nombre} duplica la regla de calificación`);
    assert.ok(!p.includes('em dashes'),              `${nombre} duplica la regla de tildes`);
  }
});

test('el esqueleto individual conserva lo que hace comparable la evaluacion', () => {
  const p = DEFAULT_INDIVIDUAL_PROMPT;
  for (const s of ['CRITERIOS LINNER', 'CRITERIOS CERRADOR', 'GUION ESPERADO',
                   'REGLAS DE CONTEO', 'DIFERENCIADORES DEL PRODUCTO']) {
    assert.ok(p.includes(s), `falta la seccion ${s}`);
  }
  // La regla que solo tenían Aristea y Midstorage, ahora para todos.
  assert.match(p, /No contar llamadas con razones de perdida no atribuibles/);
  // La inferencia de rol, que solo tenía la plantilla consultiva.
  assert.match(p, /inferirlo del estilo/);
  // 16 criterios de cerrador: la plantilla compacta tenía 8.
  const cerrador = p.slice(p.indexOf('CRITERIOS CERRADOR'), p.indexOf('DIFERENCIADORES'));
  assert.equal(cerrador.split('\n').filter(l => l.startsWith('- ')).length, 16);
});

test('las reglas compartidas siguen intactas tras moverlas de archivo', () => {
  assert.match(CALIFICACION_INSTRUCTION, /descartado_no_califica/);
  assert.match(CALIFICACION_INSTRUCTION, /pct_descarte_justificado/);
  assert.match(NO_DASH_INSTRUCTION, /em dashes/);
  assert.match(NO_DASH_INSTRUCTION, /tildes/);
  // Ambas empiezan con dos saltos: se concatenan al final de un prompt.
  assert.ok(CALIFICACION_INSTRUCTION.startsWith('\n\n'));
  assert.ok(NO_DASH_INSTRUCTION.startsWith('\n\n'));
});
