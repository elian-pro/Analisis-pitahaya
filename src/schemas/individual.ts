import { z } from 'zod';

export const NivelEnum     = z.enum(['excelente', 'bueno', 'aceptable', 'necesita_mejora', 'critico']);
export const PrioridadEnum = z.enum(['alta', 'media', 'baja']);
export const ImpactoEnum   = z.enum(['alta', 'media', 'baja']);

// ── What Claude must return for one advisor ───────────────────────────────────

export const ClaudeIndividualOutputSchema = z.object({
  tipo_asesor:              z.enum(['linner', 'cerrador', 'desconocido']),
  nivel:                    NivelEnum,
  objeciones_por_llamada:   z.number().nonnegative(),
  tasa_resolucion_global:   z.number().min(0).max(100),
  pct_logra_siguiente_paso: z.number().min(0).max(100),
  resumen:                  z.string().min(1),

  criterios: z.array(z.object({
    nombre:      z.string(),
    puntaje:     z.number(),
    max_puntaje: z.number(),
    porcentaje:  z.number().min(0).max(100),
  })).min(1),

  elementos_producto: z.array(z.object({
    elemento:     z.string(),
    pct_llamadas: z.number().min(0).max(100),
  })),
  elementos_subutilizados: z.array(z.string()),

  objeciones: z.array(z.object({
    categoria:                   z.string(),
    veces:                       z.number().int().nonnegative(),
    pct_llamadas:                z.number().min(0).max(100),
    tasa_resolucion:             z.number().min(0).max(100),
    tecnicas:                    z.string(),
    ejemplo_objecion:            z.string(),
    ejemplo_respuesta_efectiva:  z.string(),
    ejemplo_respuesta_fallida:   z.string(),
  })),
  categorias_peor_manejadas: z.array(z.object({
    categoria: z.string(),
    consejo:   z.string(),
  })),

  sesgos: z.array(z.object({
    nombre:               z.string(),
    promedio_por_llamada: z.number().nonnegative(),
    pct_llamadas:         z.number().min(0).max(100),
  })),
  sesgos_subutilizados: z.array(z.string()),

  talk_ratio:         z.number().min(0).max(100),
  preguntas_promedio: z.number().nonnegative(),

  cierres: z.object({
    apartado:           z.number().int().nonnegative(),
    cita_seguimiento:   z.number().int().nonnegative(),
    firma:              z.number().int().nonnegative(),
    fecha_decision:     z.number().int().nonnegative(),
    sin_siguiente_paso: z.number().int().nonnegative(),
  }),

  fortalezas: z.array(z.object({
    descripcion:  z.string(),
    pct_llamadas: z.number().min(0).max(100),
    cita:         z.string().optional(),
  })).min(1),

  debilidades: z.array(z.object({
    descripcion:  z.string(),
    pct_llamadas: z.number().min(0).max(100),
    impacto:      ImpactoEnum,
  })).min(1),

  mejor_llamada: z.object({ score: z.number(), fecha: z.string(), lead: z.string(), descripcion: z.string() }),
  mejor_llamada_indice: z.number().int().positive(),
  peor_llamada:  z.object({ score: z.number(), fecha: z.string(), lead: z.string(), descripcion: z.string() }),

  recomendaciones: z.array(z.object({
    prioridad: PrioridadEnum,
    area:      z.string(),
    accion:    z.string(),
    metrica:   z.string(),
  })).min(1),
});

export type ClaudeIndividualOutput = z.infer<typeof ClaudeIndividualOutputSchema>;

// ── Full data passed to the PDF template ─────────────────────────────────────

export interface IndividualReportData extends ClaudeIndividualOutput {
  asesor:                  string;
  mes:                     string;    // "YYYY-MM"
  mes_label:               string;    // "Mayo 2026"
  period_label?:           string;    // "Semana 05/05 al 11/05", undefined for monthly
  call_count:              number;
  avg_score:               number;
  score_min:               number;
  score_max:               number;
  score_sigma:             number;
  generated_date:          string;    // "DD/MM/YYYY"
  has_previous:            boolean;
  delta_score?:            number;    // positive = improved vs previous period
  delta_siguiente_paso?:   number;
  delta_talk_ratio?:       number;
  mejor_llamada_record_url?: string;   // link de la grabacion de la mejor llamada (si la hoja tiene la columna)
}
