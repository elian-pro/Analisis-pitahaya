import { z } from 'zod';
import { PrioridadEnum } from './individual';

// ── What Claude must return for the general (team) report ─────────────────────

export const ClaudeGeneralOutputSchema = z.object({
  resumen_ejecutivo:  z.string().min(1),
  tendencia_equipo:   z.enum(['mejora', 'estable', 'mixto', 'retroceso', 'primer_mes']),
  fortalezas_equipo:  z.array(z.string()).min(1),
  areas_oportunidad:  z.array(z.string()).min(1),

  mejores_practicas: z.array(z.object({
    asesor:       z.string(),
    practica:     z.string(),
    descripcion:  z.string(),
  })),

  patrones_objeciones: z.array(z.object({
    categoria:      z.string(),
    frecuencia:     z.string(),    // e.g. "4 de 5 asesores"
    recomendacion:  z.string(),
  })),

  recomendaciones: z.array(z.object({
    prioridad:   PrioridadEnum,
    area:        z.string(),
    descripcion: z.string(),
    dirigido_a:  z.string(), // "Todo el equipo" | "Felipe, Ana"
  })).min(1),
});

export type ClaudeGeneralOutput = z.infer<typeof ClaudeGeneralOutputSchema>;

// ── Full data passed to the general PDF template ──────────────────────────────

export interface GeneralReportData extends ClaudeGeneralOutput {
  cliente:          string;
  mes_label:        string;
  generated_date:   string;  // "DD/MM/YYYY"
  total_asesores:   number;
  total_llamadas:   number;
  avg_score_equipo: number;
  ranking: Array<{
    posicion:   number;
    asesor:     string;
    avg_score:  number;
    score_min:  number;
    score_max:  number;
    call_count: number;
    nivel:      string;
  }>;
}
