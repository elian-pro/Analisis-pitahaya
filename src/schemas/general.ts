import { z } from 'zod';
import { PrioridadEnum } from './individual';

// ── What Claude must return for the general (team) report ─────────────────────

export const ClaudeGeneralOutputSchema = z.object({
  resumen_ejecutivo:  z.string().min(1),
  tendencia_equipo:   z.enum(['mejora', 'estable', 'mixto', 'retroceso', 'primer_mes']),

  kpi_bullets: z.array(z.object({
    label:     z.string(),
    valor:     z.string(),
    variacion: z.string().optional(),
    // 'mixto' existe aquí porque un KPI que agrega a todo el equipo puede tener
    // asesores subiendo y otros bajando, y sin esa palabra el modelo la tomaba
    // prestada de tendencia_equipo (que sí la tiene, seis líneas más arriba, en
    // el mismo JSON) y la respuesta entera se caía por validación.
    tendencia: z.enum(['mejora', 'baja', 'estable', 'mixto', 'sin_dato']),
  })).min(1),

  fortalezas_equipo:  z.array(z.string()).min(1),
  areas_oportunidad:  z.array(z.string()).min(1),

  mejores_practicas: z.array(z.object({
    asesor:      z.string(),
    practica:    z.string(),
    descripcion: z.string(),
  })),

  patrones_objeciones: z.array(z.object({
    categoria:     z.string(),
    frecuencia:    z.string(),
    recomendacion: z.string(),
  })),

  recomendaciones: z.array(z.object({
    prioridad:   PrioridadEnum,
    area:        z.string(),
    descripcion: z.string(),
    dirigido_a:  z.string(),
  })).min(1),
});

export type ClaudeGeneralOutput = z.infer<typeof ClaudeGeneralOutputSchema>;

// ── Full data passed to the general PDF template ──────────────────────────────

export interface GeneralReportData extends ClaudeGeneralOutput {
  cliente:          string;
  mes_label:        string;
  period_label?:    string;    // "Semana 05/05 al 11/05", undefined for monthly
  generated_date:   string;    // "DD/MM/YYYY"
  total_asesores:   number;
  total_llamadas:   number;
  avg_score_equipo: number;
  ranking: Array<{
    posicion:    number;
    asesor:      string;
    avg_score:   number;
    score_min:   number;
    score_max:   number;
    call_count:  number;
    nivel:       string;
    delta_score?: number;
  }>;
}
