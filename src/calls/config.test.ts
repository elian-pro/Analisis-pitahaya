import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { debeBarrer, type CallsConfig } from './config';

// `debeBarrer` es la única pieza del interruptor que se puede probar sin base de
// datos, y por eso vive en config.ts y no en sweeper.ts: importar el sweeper
// arrastra pipeline → config/env, que hace process.exit(1) al cargarse sin
// credenciales y se llevaría por delante el runner entero.

const cfg = (p: Partial<CallsConfig> = {}): CallsConfig =>
  ({ esquema: 'X_callpicker', desde: '2026-08-01', contexto_negocio: null, auto: true, ...p });

test('sin fila de configuracion no se barre', () => {
  // La regla que sustituye a CALLS_PIPELINE. `.env.example` documenta crear la
  // tabla `analisis` a mano; sin esto, ese schema se pondria a procesar su
  // historico en el primer tick sin que nadie lo hubiera pedido.
  assert.equal(debeBarrer(undefined), false);
});

test('el interruptor apagado manda', () => {
  assert.equal(debeBarrer(cfg({ auto: false })), false);
});

test('con fila y el interruptor encendido se barre', () => {
  assert.equal(debeBarrer(cfg()), true);
});

test('una fila sin fecha sigue barriendo: la fecha la resuelve el sweeper', () => {
  // `desde` en null no apaga nada. Quien decide desde cuando es listPendientes,
  // y confundir las dos cosas dejaria un origen encendido sin procesar nada.
  assert.equal(debeBarrer(cfg({ desde: null })), true);
});

test('una fila vieja, sin la columna todavia, cuenta como encendida', () => {
  // Postgres rellena `auto` con DEFAULT true al añadir la columna, pero si
  // alguna lectura llegara sin el campo, lo seguro es NO apagar un origen que
  // el equipo cree encendido.
  assert.equal(debeBarrer({ esquema: 'X', desde: null, contexto_negocio: null } as CallsConfig), true);
});

// El interruptor invisible no vuelve. `CALLS_PIPELINE` era una variable de
// entorno que decidía si el pipeline procesaba algo, no se veía desde ninguna
// pantalla, y estuvo un día entero en "off" con las llamadas acumulándose sin
// que nadie lo notara. Ahora el interruptor está en Ajustes, por origen.
//
// En COMENTARIOS sí puede aparecer —explicar por qué se quitó tiene valor—, así
// que el test los descarta antes de mirar: lo que prohíbe es que vuelva a haber
// código leyéndola.
test('nadie vuelve a leer la variable de entorno del barrido', () => {
  const RAIZ = path.join(__dirname, '..');
  const YO   = path.join(__dirname, 'config.test.ts');

  const ficheros = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return ficheros(p);
      return e.isFile() && p.endsWith('.ts') && p !== YO ? [p] : [];
    });

  const sinComentarios = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const culpables = ficheros(RAIZ).filter(f =>
    /CALLS_PIPELINE|callsPipelineEnabled/.test(sinComentarios(fs.readFileSync(f, 'utf-8'))));

  assert.deepEqual(culpables.map(f => path.relative(RAIZ, f)), [],
    'el barrido volvió a depender de una variable de entorno invisible');
});
