import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Reporte "Radar de Objeciones": analiza todas las llamadas del periodo de un
// cliente (unidad = cliente, no asesor) y produce, por IA, las preguntas más
// frecuentes de los prospectos, cómo las responde el equipo y qué patrones hay.
// Los números duros (totales, deltas vs periodo anterior) los calcula el código.
// ─────────────────────────────────────────────────────────────────────────────

export const RadarEvaluacionEnum = z.enum(['bien', 'mejorable', 'critico']);
export const RadarPrioridadEnum  = z.enum(['alta', 'media', 'baja']);

// Slug canónico: minúsculas, sin acentos, palabras unidas por guiones.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const RadarQuestionSchema = z.object({
  categoria_id:      z.string().regex(SLUG_RE, 'categoria_id debe ser un slug (minusculas, guiones)'),
  pregunta_canonica: z.string().min(1),          // fraseo representativo de la pregunta
  frecuencia:        z.number().int().min(1),     // nº de llamadas donde aparece
  llamadas:          z.array(z.number().int()),   // índices de evidencia (1-based)
  respuesta_tipica:  z.string().min(1),           // qué contesta el equipo hoy (patrón real)
  evaluacion:        RadarEvaluacionEnum,
  observacion:       z.string().min(1),           // insight accionable (1-3 frases)
  cita:              z.string().max(160).optional(), // cita corta de evidencia
});
export type RadarQuestion = z.infer<typeof RadarQuestionSchema>;

// ── Lo que Claude DEBE devolver (tool use forzado) ───────────────────────────
export const ClaudeRadarOutputSchema = z.object({
  executive_summary: z.string().min(1),
  preguntas: z.array(RadarQuestionSchema).min(5).max(18),
  patrones_prospectos: z.array(z.object({
    titulo:      z.string().min(1),
    descripcion: z.string().min(1),
    llamadas:    z.array(z.number().int()),
  })),
  patrones_equipo: z.object({
    fortalezas:   z.array(z.object({ titulo: z.string().min(1), descripcion: z.string().min(1) })),
    areas_mejora: z.array(z.object({ titulo: z.string().min(1), descripcion: z.string().min(1) })),
  }),
  // Narrativa comparativa de la IA (el "por qué"); solo si hubo periodo anterior.
  analisis_comparativo: z.string().optional(),
  recomendaciones: z.array(z.object({
    prioridad:   RadarPrioridadEnum,
    titulo:      z.string().min(1),
    descripcion: z.string().min(1),
  })).min(1).max(6),
});
export type ClaudeRadarOutput = z.infer<typeof ClaudeRadarOutputSchema>;

// ── Comparativo DETERMINISTA (calculado en código, no por la IA) ─────────────
export interface RadarDelta {
  categoria_id:        string;
  pregunta:            string;
  freq_actual:         number;
  freq_anterior:       number;
  delta:               number;   // freq_actual - freq_anterior
  evaluacion_actual:   string;
  evaluacion_anterior: string;
  cambio_evaluacion:   'mejoro' | 'empeoro' | 'igual';
}

export interface RadarComparativo {
  prev_period_label: string;
  deltas:            RadarDelta[];
  nuevas:            string[];   // categoria_id nuevos este periodo
  desaparecidas:     string[];   // categoria_id que ya no aparecen
}

// ── Lo que recibe la plantilla PDF: output IA + determinista + labels ────────
export interface RadarReportData extends ClaudeRadarOutput {
  client_name:    string;
  period_label:   string;   // "Junio 2026"
  period_key:     string;   // "YYYY-MM"
  date_from:      string;
  date_to:        string;
  generated_date: string;   // "DD/MM/YYYY"
  total_calls:    number;   // en la fuente, antes de filtrar
  analyzed_calls: number;   // tras filtrar (duración/frases/rango)
  excluded_calls: number;   // total - analyzed
  is_first_period: boolean;
  source:         'database' | 'markdown_upload';
  comparativo?:   RadarComparativo;
}
