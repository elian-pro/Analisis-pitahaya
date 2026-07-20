import { renderPdf } from '../pdf/renderer';
import { analyzeRadar, type RadarPeriodMeta, type RadarCall } from '../claude/radar';
import { buildRadarSidecar, serializeRadarSidecar, type RadarSidecar } from './sidecar';
import type { RadarReportData } from '../schemas/radar';

// Punto de convergencia de los dos flujos (base de datos y archivo .md): dado el
// prompt, el periodo y las llamadas, produce el reporte (IA) + el PDF + el
// sidecar. NO decide la entrega (subir a Drive / descargar): eso lo resuelve
// cada flujo por separado.

export interface RadarResult {
  reportData:    RadarReportData;
  pdfBuffer:     Buffer;
  sidecar:       RadarSidecar;
  sidecarJson:   string;
  input_tokens:  number;
  output_tokens: number;
}

export async function processRadarReport(
  systemPrompt: string,
  meta:         RadarPeriodMeta,
  calls:        RadarCall[],
  prevSidecar:  RadarSidecar | null,
): Promise<RadarResult> {
  const { reportData, input_tokens, output_tokens } = await analyzeRadar(systemPrompt, meta, calls, prevSidecar);
  const pdfBuffer = await renderPdf('radar', reportData as unknown as Record<string, unknown>);
  const sidecar   = buildRadarSidecar(reportData);
  return { reportData, pdfBuffer, sidecar, sidecarJson: serializeRadarSidecar(sidecar), input_tokens, output_tokens };
}
