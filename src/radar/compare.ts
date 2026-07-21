import type { ClaudeRadarOutput, RadarComparativo, RadarDelta } from '../schemas/radar';
import type { RadarSidecar } from './sidecar';

// ─────────────────────────────────────────────────────────────────────────────
// Comparativo mes-a-mes del Radar, todo DETERMINISTA (no lo calcula la IA).
//
// El cruce se hace por `categoria_id`. Para que funcione, las preguntas deben
// tener identidad estable entre periodos. La primera defensa es el prompt (que
// inyecta la taxonomía anterior y obliga a reutilizar slugs). Esta es la SEGUNDA
// defensa (la "capa extra"): si Claude igual inventó un slug nuevo que en realidad
// es la misma pregunta que una anterior, aquí se detecta por parecido léxico
// (del slug y del texto canónico) y se re-mapea al slug previo, evitando falsos
// "nuevas/desaparecidas".
// ─────────────────────────────────────────────────────────────────────────────

const REMAP_THRESHOLD = 0.62;

const STOPWORDS = new Set([
  'de','la','el','los','las','un','una','unos','unas','que','cual','cuales','cuanto',
  'cuanta','cuantos','cuantas','como','es','son','en','y','o','u','a','con','para','por',
  'se','su','sus','mi','me','te','lo','le','les','del','al','the','of','me','mas','muy',
]);

export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentWords(s: string): Set<string> {
  return new Set(
    normalize(s).split(/[\s-]+/).filter(w => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Distancia de Levenshtein normalizada → ratio de similitud [0,1].
function levenshteinRatio(a: string, b: string): number {
  a = normalize(a); b = normalize(b);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  const dist = dp[a.length];
  return 1 - dist / Math.max(a.length, b.length);
}

// Parecido entre dos preguntas (slug + texto). Favorece el slug (más estable).
export function questionSimilarity(
  a: { categoria_id: string; pregunta_canonica: string },
  b: { categoria_id: string; pregunta_canonica: string },
): number {
  const slugTokens = jaccard(
    new Set(a.categoria_id.split('-')),
    new Set(b.categoria_id.split('-')),
  );
  const slugLev = levenshteinRatio(a.categoria_id, b.categoria_id);
  const slugSim = Math.max(slugTokens, slugLev);
  const textSim = jaccard(contentWords(a.pregunta_canonica), contentWords(b.pregunta_canonica));
  return Math.max(slugSim, textSim * 0.9);
}

export interface Remap {
  from:  string;   // slug que trajo Claude
  to:    string;   // slug previo al que se re-mapea
  score: number;
}

// Re-mapea los slugs "nuevos" de Claude a un slug previo cuando el parecido supera
// el umbral y ese slug previo no lo usa ya otra pregunta de este periodo.
export function reconcileTaxonomy(
  current: ClaudeRadarOutput,
  prev: RadarSidecar | null,
): { reconciled: ClaudeRadarOutput; remaps: Remap[] } {
  if (!prev || prev.questions.length === 0) return { reconciled: current, remaps: [] };

  const prevBySlug = new Map(prev.questions.map(q => [q.categoria_id, q]));
  const usedThisPeriod = new Set(current.preguntas.map(q => q.categoria_id));
  const remaps: Remap[] = [];

  const preguntas = current.preguntas.map(q => {
    if (prevBySlug.has(q.categoria_id)) return q; // ya coincide, nada que hacer

    // Busca el mejor candidato previo por parecido.
    let best: { slug: string; score: number } | null = null;
    for (const pq of prev.questions) {
      if (usedThisPeriod.has(pq.categoria_id)) continue; // ese slug previo ya lo tomó otra pregunta
      const score = questionSimilarity(q, pq);
      if (!best || score > best.score) best = { slug: pq.categoria_id, score };
    }

    if (best && best.score >= REMAP_THRESHOLD) {
      remaps.push({ from: q.categoria_id, to: best.slug, score: Math.round(best.score * 100) / 100 });
      usedThisPeriod.delete(q.categoria_id);
      usedThisPeriod.add(best.slug);
      return { ...q, categoria_id: best.slug };
    }
    return q;
  });

  return { reconciled: { ...current, preguntas }, remaps };
}

// Rango de evaluación para saber si mejoró o empeoró (más alto = mejor).
const EVAL_RANK: Record<string, number> = { critico: 0, mejorable: 1, bien: 2 };

export function computeComparativo(
  reconciled: ClaudeRadarOutput,
  prev: RadarSidecar,
): RadarComparativo {
  const prevBySlug = new Map(prev.questions.map(q => [q.categoria_id, q]));
  const currBySlug = new Map(reconciled.preguntas.map(q => [q.categoria_id, q]));

  const deltas: RadarDelta[] = [];
  for (const q of reconciled.preguntas) {
    const p = prevBySlug.get(q.categoria_id);
    if (!p) continue; // pregunta nueva → va en `nuevas`, no en deltas
    const rankNow  = EVAL_RANK[q.evaluacion] ?? 1;
    const rankPrev = EVAL_RANK[p.evaluacion] ?? 1;
    deltas.push({
      categoria_id:        q.categoria_id,
      pregunta:            q.pregunta_canonica,
      freq_actual:         q.frecuencia,
      freq_anterior:       p.frecuencia,
      delta:               q.frecuencia - p.frecuencia,
      evaluacion_actual:   q.evaluacion,
      evaluacion_anterior: p.evaluacion,
      cambio_evaluacion:   rankNow > rankPrev ? 'mejoro' : rankNow < rankPrev ? 'empeoro' : 'igual',
    });
  }

  const nuevas        = reconciled.preguntas.map(q => q.categoria_id).filter(s => !prevBySlug.has(s));
  const desaparecidas = prev.questions.map(q => q.categoria_id).filter(s => !currBySlug.has(s));

  return { prev_period_label: prev.period_label, deltas, nuevas, desaparecidas };
}
