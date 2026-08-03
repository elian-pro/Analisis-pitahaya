import { z } from 'zod';

export const NivelEnum     = z.enum(['elite', 'alto_desempeno', 'consistente', 'en_progreso', 'punto_de_partida']);
export const PrioridadEnum = z.enum(['alta', 'media', 'baja']);
export const ImpactoEnum   = z.enum(['alta', 'media', 'baja']);

export type Nivel = z.infer<typeof NivelEnum>;

/**
 * Deriva el nivel del score promedio. Antes lo elegia Claude libremente (sin
 * rubrica en el prompt), asi que dos asesores con el mismo score podian salir
 * con niveles distintos y el chip contradecia a la columna de al lado.
 * Umbrales iguales para todos los clientes.
 */
export function nivelFromScore(avgScore: number): Nivel {
  if (avgScore >= 85) return 'elite';
  if (avgScore >= 70) return 'alto_desempeno';
  if (avgScore >= 55) return 'consistente';
  if (avgScore >= 40) return 'en_progreso';
  return 'punto_de_partida';
}

// Cómo se escribe el nivel en el PDF. El valor del enum es un slug (va en
// clases CSS); el texto visible se toma de aquí y nunca de un replace sobre el
// slug, que con dos guiones bajos dejaba a medias "punto de_partida".
const NIVEL_LABEL: Record<Nivel, string> = {
  elite:            'Élite',
  alto_desempeno:   'Alto desempeño',
  consistente:      'Consistente',
  en_progreso:      'En progreso',
  punto_de_partida: 'Punto de partida',
};

export function nivelLabel(nivel: Nivel): string {
  return NIVEL_LABEL[nivel] ?? nivel;
}

// ── What Claude must return for one advisor ───────────────────────────────────

export const ClaudeIndividualOutputSchema = z.object({
  tipo_asesor:              z.enum(['linner', 'cerrador', 'desconocido']),
  objeciones_por_llamada:   z.number().nonnegative(),
  tasa_resolucion_global:   z.number().min(0).max(100),
  // Solo sobre llamadas CALIFICADAS: descartar un lead que no califica es un
  // resultado correcto, no un cierre fallido, y antes hundia este porcentaje.
  pct_logra_siguiente_paso: z.number().min(0).max(100),
  // De las llamadas descartadas, en cuantas el asesor se apoyo en criterios
  // reales (presupuesto, tiempo, decision, encaje) antes de cortar. Sin esto,
  // "descarte" seria una salida gratis para quien se quita las llamadas de
  // encima; aqui se mide el criterio, no el volumen de descartes.
  pct_descarte_justificado: z.number().min(0).max(100),
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
    // Cerro sin avanzar teniendo un lead que SI calificaba: eso es lo que se
    // le puede reprochar al asesor.
    sin_siguiente_paso: z.number().int().nonnegative(),
    // Cerro porque el lead no calificaba. Categoria aparte a proposito: iba
    // mezclada con la anterior y las dos son cosas opuestas.
    descartado_no_califica: z.number().int().nonnegative().default(0),
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
  nivel:                   Nivel;    // derivado de avg_score, ver nivelFromScore
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

// ── Sidecar de metricas ──────────────────────────────────────────────────────
// Lo que se escribe en Drive al cerrar un periodo y se relee en el siguiente
// para el comparativo. Vive aqui, sin dependencias, porque es un contrato de
// datos: probarlo no deberia exigir credenciales de Google ni de Anthropic.

export interface PreviousMetrics {
  avg_score:                number;
  pct_logra_siguiente_paso: number;
  talk_ratio:               number;
  metrics_version:          number;   // 1 = antes de separar los descartes
}

// Sube cuando cambia el SIGNIFICADO de una metrica del sidecar, no cuando se
// agrega una nueva: es lo que decide si el comparativo con el periodo anterior
// esta midiendo lo mismo.
export const SIDECAR_METRICS_VERSION = 2;

export function parseSidecarMetrics(text: string): PreviousMetrics | null {
  const match = text.match(/=== METRICAS_JSON ===\n(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (
      typeof parsed.avg_score === 'number' &&
      typeof parsed.pct_logra_siguiente_paso === 'number' &&
      typeof parsed.talk_ratio === 'number'
    ) {
      return {
        avg_score:                parsed.avg_score,
        pct_logra_siguiente_paso: parsed.pct_logra_siguiente_paso,
        talk_ratio:               parsed.talk_ratio,
        metrics_version:          typeof parsed.metrics_version === 'number' ? parsed.metrics_version : 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

