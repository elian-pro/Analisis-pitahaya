import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Este test no prueba una función: prueba una regla de arquitectura, porque es
// la regla que ya se rompió una vez y en silencio.
//
// Cuando Midstorage pasó a leer de Postgres, los reportes funcionaban pero la
// pestaña Reportes marcaba a los diez asesores con "Sin llamadas en este
// periodo", y las automatizaciones en modo "solo activos" se los saltaban a
// todos sin dar error. El motivo: readCalls sí respetaba la fuente del cliente,
// pero routes/advisors y schedules/runner le preguntaban a la hoja por su
// cuenta. Nada falla, simplemente contesta cero.
//
// Un test de comportamiento no lo habría atrapado (haría falta simular dos
// backends). Este sí: prohíbe la importación que lo causa.

const RAIZ = path.join(__dirname, '..');

/** Solo calls/read.ts puede pedirle datos de llamadas a la hoja. */
const PUERTA = path.join(RAIZ, 'calls', 'read.ts');

/** Funciones que responden "qué llamadas hay" o "quién tuvo llamadas". */
const LECTORES = [
  'getCallData', 'getAdvisorCallCounts', 'getAdvisorNamesWithCalls',
  'getAdvisors', 'getAdvisorsForMonth',
];

function ficherosTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ficherosTs(p);
    return e.isFile() && p.endsWith('.ts') ? [p] : [];
  });
}

test('solo calls/read.ts lee llamadas de la hoja', () => {
  const culpables: string[] = [];

  for (const f of ficherosTs(RAIZ)) {
    if (f === PUERTA || f.endsWith(path.join('google', 'sheets.ts'))) continue;
    const src = fs.readFileSync(f, 'utf-8');

    // Importar el TIPO CallRow es legítimo: es la forma que comparten las dos
    // fuentes, y de hecho es lo que permite que el resto no se entere.
    for (const m of src.matchAll(/import\s+(?!type\s)\{([^}]+)\}\s+from\s+'[^']*google\/sheets'/g)) {
      const nombres = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
      const prohibidos = nombres.filter(n => LECTORES.includes(n));
      if (prohibidos.length) {
        culpables.push(`${path.relative(RAIZ, f)} → ${prohibidos.join(', ')}`);
      }
    }
  }

  assert.deepEqual(culpables, [],
    'estos módulos preguntan a Sheets saltándose calls/read.ts, así que un cliente '
    + 'con fuente Postgres les contestará cero sin dar ningún error:\n  '
    + culpables.join('\n  '));
});
