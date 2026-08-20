/**
 * Compara dos salidas de `dry-run` del MISMO asesor y periodo: la de antes de
 * tocar el prompt y la de después. Es la verificación de las fases 5 a 7.
 *
 * Existe porque la comparación no se puede hacer a ojo ni con `diff`: los textos
 * cualitativos cambian siempre —Claude no es determinista— y eso ahoga lo único
 * que importa, que es si se movió algo que NO debía moverse.
 *
 * Usage:
 *   tsx src/cli/dry-run-diff.ts <antes.json> <despues.json>
 *   node dist/cli/dry-run-diff.js fixtures/a.json fixtures/b.json   (en el contenedor)
 */

import fs from 'fs';

const [,, fileA, fileB] = process.argv;

if (!fileA || !fileB) {
  console.error('Usage: tsx src/cli/dry-run-diff.ts <antes.json> <despues.json>');
  process.exit(1);
}

interface Reporte {
  asesor?: string; mes?: string;
  avg_score: number; call_count: number; score_min: number; score_max: number; score_sigma: number;
  tipo_asesor: string;
  pct_logra_siguiente_paso: number; pct_descarte_justificado: number;
  objeciones_por_llamada: number; tasa_resolucion_global: number;
  criterios: { nombre: string; porcentaje: number }[];
  elementos_producto: { elemento: string }[];
  elementos_subutilizados: string[];
  objeciones: { categoria: string }[];
  recomendaciones: unknown[];
}

const leer = (p: string): Reporte => {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { console.error(`No se pudo leer ${p}: ${(e as Error).message}`); process.exit(1); }
};

const a = leer(fileA);
const b = leer(fileB);

const lista  = (xs: string[]) => xs.length ? xs.join(', ') : '—';
const nuevos = (x: string[], y: string[]) => y.filter(v => !x.includes(v));

console.log(`\n🦓 Dry-run: antes → después`);
console.log(`   ${a.asesor ?? '?'} · ${a.mes ?? '?'}\n`);

// ── Lo que NO puede cambiar ──────────────────────────────────────────────────
// Sale de computeMetrics(), que promedia las calificaciones de las llamadas. No
// lo escribe Claude, así que un cambio aquí no es "el prompt evalúa distinto":
// es que se comparó otro periodo, otro asesor u otra fuente de llamadas.
const DETERMINISTAS = ['avg_score', 'call_count', 'score_min', 'score_max', 'score_sigma'] as const;
const movidas = DETERMINISTAS.filter(k => a[k] !== b[k]);

console.log('── Determinista (no debe moverse) ──');
for (const k of DETERMINISTAS) {
  const igual = a[k] === b[k];
  console.log(`   ${igual ? '✓' : '✗'} ${k.padEnd(12)} ${a[k]} ${igual ? '' : `→ ${b[k]}`}`);
}

// ── Lo que sí se mueve, y hay que mirar ──────────────────────────────────────
const delta = (x: number, y: number) => {
  const d = Math.round((y - x) * 10) / 10;
  return `${x} → ${y}${d === 0 ? '' : ` (${d > 0 ? '+' : ''}${d})`}`;
};

console.log('\n── Lo evalúa el modelo (se mueve; mirar que tenga sentido) ──');
console.log(`   tipo_asesor              ${a.tipo_asesor} → ${b.tipo_asesor}` +
  (b.tipo_asesor === 'desconocido' && a.tipo_asesor !== 'desconocido' ? '   ⚠ perdió el rol' : ''));
console.log(`   pct_logra_siguiente_paso ${delta(a.pct_logra_siguiente_paso, b.pct_logra_siguiente_paso)}`);
console.log(`   pct_descarte_justificado ${delta(a.pct_descarte_justificado, b.pct_descarte_justificado)}`);
console.log(`   objeciones_por_llamada   ${delta(a.objeciones_por_llamada, b.objeciones_por_llamada)}`);
console.log(`   tasa_resolucion_global   ${delta(a.tasa_resolucion_global, b.tasa_resolucion_global)}`);

// ── Criterios: el cambio esperado del esqueleto ──────────────────────────────
// La plantilla compacta tenía 8 ítems de cerrador y el esqueleto 16, así que
// aquí es normal ver movimiento. Lo que se revisa es que los nuevos nombres
// describan al asesor y no al catálogo del cliente.
const nomA = a.criterios.map(c => c.nombre);
const nomB = b.criterios.map(c => c.nombre);
console.log(`\n── Criterios: ${nomA.length} → ${nomB.length} ──`);
console.log(`   aparecen: ${lista(nuevos(nomA, nomB))}`);
console.log(`   se van:   ${lista(nuevos(nomB, nomA))}`);

// ── Diferenciadores: la prueba de que el contexto llegó ──────────────────────
// El esqueleto dice "evalúa los diferenciadores que el CONTEXTO describe". Si
// esta lista se vacía al quitar el prompt propio, el contexto se quedó corto.
const elemA = a.elementos_producto.map(e => e.elemento);
const elemB = b.elementos_producto.map(e => e.elemento);
console.log(`\n── Diferenciadores detectados: ${elemA.length} → ${elemB.length} ──`);
console.log(`   aparecen: ${lista(nuevos(elemA, elemB))}`);
console.log(`   se van:   ${lista(nuevos(elemB, elemA))}`);
if (elemB.length === 0 && elemA.length > 0) {
  console.log('   ⚠ el reporte nuevo no reconoció ningún diferenciador: revisa el contexto del negocio');
}

console.log(`\n── Volumen ──`);
console.log(`   objeciones      ${a.objeciones.length} → ${b.objeciones.length}`);
console.log(`   recomendaciones ${a.recomendaciones.length} → ${b.recomendaciones.length}`);
console.log(`   subutilizados   ${a.elementos_subutilizados.length} → ${b.elementos_subutilizados.length}`);

if (movidas.length) {
  console.log(`\n❌ Se movió una métrica determinista (${movidas.join(', ')}).`);
  console.log(`   El prompt no puede cambiarlas: compara el mismo asesor, mes y fuente.`);
  process.exit(1);
}
console.log(`\n✅ Las métricas deterministas no se movieron: el cambio es de criterio, no de datos.`);
