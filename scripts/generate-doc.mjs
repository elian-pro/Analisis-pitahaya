#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Regenera docs/QUE-ES-ZEBRA-REPORTS.md a partir del código fuente actual, usando
// Claude. Lo ejecuta la GitHub Action .github/workflows/update-doc.yml en cada
// cambio de código, para que la explicación en lenguaje natural se mantenga al día.
//
// Uso local:  ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-doc.mjs
//
// Sin dependencias: usa el fetch nativo de Node 20+. No necesita `npm install`.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = join(ROOT, 'docs', 'QUE-ES-ZEBRA-REPORTS.md');
const MODEL    = 'claude-sonnet-4-6';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('❌ Falta ANTHROPIC_API_KEY. Agrégala como secret del repositorio (Settings → Secrets and variables → Actions).');
  process.exit(1);
}

// Archivos que determinan el CONTENIDO del documento. Si el análisis, el flujo o
// los datos del PDF cambian, es en estos archivos donde se nota, así que son los
// que alimentan la regeneración.
const SOURCE_FILES = [
  'src/schedules/runner.ts',   // disparo, periodo, roster, notificaciones
  'src/jobs/runner.ts',        // orquestación: lectura, filtros, análisis, PDF, Drive
  'src/google/sheets.ts',      // lectura de datos y filtros de calidad
  'src/claude/individual.ts',  // análisis individual (determinista + IA)
  'src/claude/general.ts',     // reporte ejecutivo del equipo
  'src/schemas/individual.ts', // qué datos lleva el PDF individual
  'src/schemas/general.ts',    // qué datos lleva el PDF general
  'src/metrics/aggregate.ts',  // tablero de evolución
];

function readSafe(relPath) {
  try { return readFileSync(join(ROOT, relPath), 'utf8'); }
  catch { return ''; }
}

// clients.json puede ser grande y contener IDs; se resume a lo estructural más un
// prompt de ejemplo, que es lo que define los "criterios del cliente".
function clientsSummary() {
  try {
    const raw  = JSON.parse(readSafe('clients.json'));
    const list = Array.isArray(raw) ? raw : (raw.clients ?? Object.values(raw));
    const first = list[0] ?? {};
    return JSON.stringify({
      total_clientes:            list.length,
      campos_de_configuracion:   Object.keys(first),
      ejemplo_prompt_individual: first.prompt_individual ?? '',
      ejemplo_prompt_general:    first.prompt_general ?? '',
      ejemplo_frases_excluidas:  first.excluded_phrases ?? [],
    }, null, 2);
  } catch {
    return '{}';
  }
}

const sourceContext = SOURCE_FILES
  .map(f => `### Archivo: ${f}\n\n\`\`\`ts\n${readSafe(f)}\n\`\`\``)
  .join('\n\n');

const currentDoc = readSafe('docs/QUE-ES-ZEBRA-REPORTS.md');

const SYSTEM = [
  'Eres un redactor técnico que escribe documentación de producto en español, clara y NO técnica,',
  'para un público de negocio (gerentes comerciales, dueños). Tu tarea es mantener actualizado un',
  'documento que explica QUÉ es la herramienta, QUÉ problema resuelve, CÓMO lo resuelve y CON QUÉ',
  'CRITERIOS, a partir del código fuente que se te entrega.',
  '',
  'Reglas estrictas:',
  '- Escribe en español correcto, con todas las tildes y la ñ. No uses guiones largos (— o –): usa',
  '  dos puntos, comas, paréntesis o punto.',
  '- Lenguaje natural y accesible. NO es un tutorial de uso ni de instalación. No incluyas comandos,',
  '  nombres de variables, rutas de archivos, IDs, claves ni jerga de programación.',
  '- Conserva la MISMA estructura, numeración de secciones y tono del documento actual que se te pasa',
  '  como referencia. Actualiza únicamente lo que el código indique que cambió (por ejemplo, nuevos',
  '  filtros, nuevos campos del PDF, cambios en el análisis o en el flujo).',
  '- Mantén intacto el comentario HTML inicial (el bloque <!-- ... --> que avisa que es autogenerado).',
  '- Devuelve SOLO el contenido Markdown final del documento, sin explicaciones adicionales y sin',
  '  envolverlo en bloques de código.',
].join('\n');

const USER = [
  'Este es el documento ACTUAL (úsalo como plantilla de estructura y tono):',
  '',
  '<<<DOCUMENTO_ACTUAL>>>',
  currentDoc,
  '<<<FIN_DOCUMENTO_ACTUAL>>>',
  '',
  'Este es un resumen de la configuración por cliente (define los "criterios del cliente"):',
  '',
  '```json',
  clientsSummary(),
  '```',
  '',
  'Este es el código fuente relevante (la fuente de verdad sobre el comportamiento real):',
  '',
  sourceContext,
  '',
  'Reescribe el documento completo para que refleje con exactitud lo que hace el código de arriba,',
  'respetando todas las reglas. Devuelve solo el Markdown.',
].join('\n');

function stripFences(text) {
  const t = text.trim();
  const m = t.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
  return (m ? m[1] : t).trim() + '\n';
}

async function main() {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'x-api-key':         API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 8192,
      system:     SYSTEM,
      messages:   [{ role: 'user', content: USER }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`❌ La API de Anthropic respondió ${res.status}: ${detail}`);
    process.exit(1);
  }

  const data     = await res.json();
  const textPart = (data.content ?? []).find(b => b.type === 'text');
  if (!textPart?.text) {
    console.error('❌ La respuesta no contiene texto.');
    process.exit(1);
  }

  const markdown = stripFences(textPart.text);
  if (markdown.length < 800) {
    console.error('❌ El documento generado es sospechosamente corto; no se sobrescribe.');
    process.exit(1);
  }

  mkdirSync(dirname(DOC_PATH), { recursive: true });
  writeFileSync(DOC_PATH, markdown, 'utf8');
  console.log(`✅ Documento regenerado (${markdown.length} caracteres) → docs/QUE-ES-ZEBRA-REPORTS.md`);
}

main().catch(err => {
  console.error('❌ Error inesperado:', err);
  process.exit(1);
});
