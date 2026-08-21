import { test } from 'node:test';
import assert from 'node:assert/strict';
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
