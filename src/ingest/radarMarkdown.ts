import type { RadarCall } from '../claude/radar';

// ─────────────────────────────────────────────────────────────────────────────
// Parser del flujo por archivo del Radar de Objeciones (§1.5 del diseño).
// Convierte un Markdown de llamadas (frontmatter opcional + bloque LLAMADAS:) en
// el MISMO arreglo de `calls` que consume el análisis, aplicando los mismos
// filtros que el flujo desde la base (duración mínima, frases excluidas, recorte).
//
// El frontmatter se parsea a mano (subconjunto de YAML: key: value + bloques
// foldeados `>`/`|`). Se evita una dependencia de YAML a propósito: nuestras
// necesidades son mínimas y así no se introduce superficie de supply-chain.
// ─────────────────────────────────────────────────────────────────────────────

export interface RadarMarkdownOverrides {
  client_name?:          string;
  period_label?:         string;
  date_from?:            string;
  date_to?:              string;
  contexto_negocio?:     string;
  min_duration_seconds?: number;   // default 200
  max_chars?:            number;   // default 8000
  excluded_phrases?:     string[]; // default []
}

export interface RadarMarkdownMeta {
  client_name:    string;
  period_label:   string;
  date_from:      string;
  date_to:        string;
  contexto?:      string;
  total_calls:    number;
  analyzed_calls: number;
  excluded_calls: number;
}

export interface RadarMarkdownResult {
  calls:    RadarCall[];
  meta:     RadarMarkdownMeta;
  warnings: string[];
}

const DEFAULT_MIN_DURATION = 200;
const DEFAULT_MAX_CHARS     = 8000;

// ── Frontmatter (subconjunto de YAML, hecho a mano) ──────────────────────────
function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const t = text.replace(/^﻿/, ''); // quita BOM
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: t };

  const data: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let rest = kv[2].trim();

    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      // Bloque foldeado/literal: junta las líneas indentadas siguientes.
      const folded = rest[0] === '>';
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        block.push(lines[++i].trim());
      }
      data[key] = folded ? block.join(' ') : block.join('\n');
    } else {
      data[key] = rest.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: t.slice(m[0].length) };
}

// ── Duración "mm:ss" / "h:mm:ss" / "372" → segundos ──────────────────────────
export function parseDurationToSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(':').map(p => parseInt(p, 10));
  if (parts.some(n => isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

interface RawBlock { idx?: number; fecha: string; asesor: string; duracion_label?: string; duracion_seg: number | null; transcripcion: string; }

function parseBlock(block: string): RawBlock | null {
  const lines = block.split(/\r?\n/);
  // Primera línea no vacía = encabezado.
  let h = 0;
  while (h < lines.length && !lines[h].trim()) h++;
  if (h >= lines.length) return null;
  const header = lines[h];
  const body = lines.slice(h + 1).join('\n').trim();

  const idxM   = header.match(/^\s*\[(\d+)\]/);
  const fechaM = header.match(/Fecha:\s*([^|]+)/i);
  const asesM  = header.match(/Asesor:\s*([^|]+)/i);
  const durM   = header.match(/Duraci[oó]n:\s*([0-9:]+)/i);

  // Si la primera línea no parece encabezado ni hay cuerpo, el bloque es solo texto.
  const looksLikeHeader = idxM || fechaM || asesM || durM;
  const transcripcion = (looksLikeHeader ? body : block).trim();
  if (!transcripcion) return null;

  const duracion_label = durM ? durM[1].trim() : undefined;
  return {
    idx:           idxM ? parseInt(idxM[1], 10) : undefined,
    fecha:         fechaM ? fechaM[1].trim() : '',
    asesor:        asesM ? asesM[1].trim() : '',
    duracion_label,
    duracion_seg:  parseDurationToSeconds(duracion_label),
    transcripcion,
  };
}

export function parseRadarMarkdown(
  fileText: string,
  overrides: RadarMarkdownOverrides = {},
): RadarMarkdownResult {
  const warnings: string[] = [];
  const { data: fm, body } = parseFrontmatter(fileText);

  // El bloque de llamadas empieza tras el marcador LLAMADAS: (obligatorio).
  // Se usa [ \t]* (no \s*) para NO consumir la línea en blanco previa: con \s*
  // el marcador arrancaría en el salto de línea anterior y dejaría "LLAMADAS:"
  // dentro del primer bloque.
  const markerMatch = body.match(/^[ \t]*LLAMADAS:[ \t]*$/im);
  if (!markerMatch || markerMatch.index === undefined) {
    throw new Error("El archivo no contiene el bloque 'LLAMADAS:'. Revisa el formato.");
  }
  const callsText = body.slice(markerMatch.index + markerMatch[0].length);

  const minDur = overrides.min_duration_seconds ?? DEFAULT_MIN_DURATION;
  const maxCh  = overrides.max_chars ?? DEFAULT_MAX_CHARS;
  const excluded = (overrides.excluded_phrases ?? []).map(p => p.toLowerCase());

  // Separa por líneas que son exactamente '---'.
  const rawBlocks = callsText
    .split(/^\s*---\s*$/m)
    .map(b => b.trim())
    .filter(Boolean);

  const parsedBlocks = rawBlocks.map(parseBlock).filter((b): b is RawBlock => b !== null);
  const total = parsedBlocks.length;
  if (total === 0) throw new Error('No se encontraron llamadas en el bloque LLAMADAS:.');

  let indexMismatch = false;
  let noDuration = 0;
  const calls: RadarCall[] = [];

  for (let i = 0; i < parsedBlocks.length; i++) {
    const b = parsedBlocks[i];
    if (b.idx !== undefined && b.idx !== i + 1) indexMismatch = true;

    // Filtro de frases excluidas.
    const lower = b.transcripcion.toLowerCase();
    if (excluded.some(p => lower.includes(p))) continue;

    // Filtro de duración: si se conoce y es menor al umbral, se excluye.
    // Si NO se conoce, se incluye (no se puede verificar) y se cuenta como sin dato.
    if (b.duracion_seg !== null) {
      if (b.duracion_seg < minDur) continue;
    } else {
      noDuration++;
    }

    calls.push({
      index:          calls.length + 1, // renumeración determinista sobre las analizadas
      fecha:          b.fecha,
      asesor:         b.asesor || 'Sin asesor',
      duracion_label: b.duracion_label,
      transcripcion:  b.transcripcion.length > maxCh ? b.transcripcion.slice(0, maxCh) : b.transcripcion,
    });
  }

  if (indexMismatch) warnings.push('Los índices [n] del archivo no eran consecutivos; se renumeraron de forma determinista.');
  if (noDuration > 0) warnings.push(`${noDuration} llamada(s) sin duración legible: se incluyeron sin verificar el umbral de ${minDur}s.`);

  // Metadatos: overrides (del formulario) > frontmatter > default.
  const pick = (k: keyof RadarMarkdownOverrides, fmKey = k) =>
    (overrides[k] as string | undefined) ?? fm[fmKey as string];

  const meta: RadarMarkdownMeta = {
    client_name:    pick('client_name')   || 'Sin nombre',
    period_label:   pick('period_label')  || '',
    date_from:      pick('date_from')      || '',
    date_to:        pick('date_to')        || '',
    contexto:       (overrides.contexto_negocio ?? fm['contexto_negocio']) || undefined,
    total_calls:    total,
    analyzed_calls: calls.length,
    excluded_calls: total - calls.length,
  };

  return { calls, meta, warnings };
}
