import type { RadarReportData } from '../schemas/radar';

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar del Radar: un JSON ligero por periodo (radar-YYYY-MM.json) que guarda
// la taxonomía y el resumen del reporte, para poder cruzarlo el mes siguiente.
// Se escribe en la carpeta de Radar y se lee al generar el periodo siguiente.
// ─────────────────────────────────────────────────────────────────────────────

export interface RadarSidecarQuestion {
  categoria_id:      string;
  pregunta_canonica: string;
  frecuencia:        number;
  evaluacion:        string;
}

export interface RadarSidecar {
  period_key:        string;   // "YYYY-MM"
  period_label:      string;   // "Junio 2026"
  questions:         RadarSidecarQuestion[];
  executive_summary: string;
  recomendaciones:   Array<{ prioridad: string; titulo: string; descripcion: string }>;
}

// Deriva el sidecar a partir del reporte generado.
export function buildRadarSidecar(data: RadarReportData): RadarSidecar {
  return {
    period_key:   data.period_key,
    period_label: data.period_label,
    questions: data.preguntas.map(q => ({
      categoria_id:      q.categoria_id,
      pregunta_canonica: q.pregunta_canonica,
      frecuencia:        q.frecuencia,
      evaluacion:        q.evaluacion,
    })),
    executive_summary: data.executive_summary,
    recomendaciones:   data.recomendaciones,
  };
}

export function serializeRadarSidecar(sidecar: RadarSidecar): string {
  return JSON.stringify(sidecar, null, 2);
}

// Parseo tolerante: devuelve null si el archivo no tiene la forma esperada, para
// que un sidecar corrupto degrade a "primer periodo" en vez de romper el reporte.
export function parseRadarSidecar(text: string): RadarSidecar | null {
  try {
    const o = JSON.parse(text) as Partial<RadarSidecar>;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.period_key !== 'string') return null;
    if (!Array.isArray(o.questions)) return null;
    const questions = o.questions.filter(
      (q): q is RadarSidecarQuestion =>
        !!q && typeof q.categoria_id === 'string' && typeof q.frecuencia === 'number',
    );
    return {
      period_key:        o.period_key,
      period_label:      typeof o.period_label === 'string' ? o.period_label : o.period_key,
      questions,
      executive_summary: typeof o.executive_summary === 'string' ? o.executive_summary : '',
      recomendaciones:   Array.isArray(o.recomendaciones) ? o.recomendaciones : [],
    };
  } catch {
    return null;
  }
}
