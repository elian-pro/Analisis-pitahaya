import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryReportMetrics } from '../metrics/store';
import { aggregateMetrics, Granularity, GRANULARITY_LABELS_ES } from '../metrics/aggregate';
import { getClient } from '../clients/manager';
import { renderPdf } from '../pdf/renderer';

const router = Router();

const GRANULARITIES: [Granularity, ...Granularity[]] = [
  'weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual',
];

// A PNG data URL as produced by Chart.js' chart.toBase64Image() in the browser.
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

const QuerySchema = z.object({
  client_id:   z.string().min(1),
  from:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  granularity: z.enum(GRANULARITIES),
  advisor:     z.string().min(1).optional(),
});

// GET /api/metrics?client_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=monthly[&advisor=...]
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  const { client_id, from, to, granularity, advisor } = parsed.data;
  try {
    const rows = await queryReportMetrics(client_id, from, to, advisor, granularity);
    const aggregated = aggregateMetrics(rows, granularity);
    res.json({
      client_id,
      from,
      to,
      granularity,
      // Qué tipo de fila se está agregando: si el cliente solo genera reportes
      // semanales, una vista mensual está sumando semanas y hay que decirlo.
      period_type: rows.period_type,
      advisors:   aggregated.advisors,
      buckets:    aggregated.buckets,
      team:       aggregated.team,
      by_advisor: aggregated.by_advisor,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const PdfBodySchema = z.object({
  client_id:         z.string().min(1),
  from:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to:                z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  granularity:       z.enum(GRANULARITIES),
  team_trend_image:  z.string().regex(PNG_DATA_URL, 'team_trend_image must be a PNG data URL').nullable(),
  ranking_image:     z.string().regex(PNG_DATA_URL, 'ranking_image must be a PNG data URL').nullable(),
});

// POST /api/metrics/pdf — same filters as GET /api/metrics, plus the chart
// images the browser already rendered (Sprint 3, Ticket 3.1: images embedded
// from the frontend, not re-rendered server-side). Re-runs the same
// query + aggregate layer from Sprint 1 to build the summary table, so the
// PDF numbers are guaranteed to match what /api/metrics returned. Streams the
// PDF back directly (no Drive upload: unlike the per-period advisor reports,
// this is an ad-hoc export of an arbitrary date range with no natural Drive
// folder/job to attach it to).
router.post('/pdf', async (req: Request, res: Response): Promise<void> => {
  const parsed = PdfBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    return;
  }
  const { client_id, from, to, granularity, team_trend_image, ranking_image } = parsed.data;
  try {
    const client = await getClient(client_id);
    if (!client) {
      res.status(404).json({ error: `Client '${client_id}' not found` });
      return;
    }

    const rows = await queryReportMetrics(client_id, from, to, undefined, granularity);
    const aggregated = aggregateMetrics(rows, granularity);

    const pdfBuffer = await renderPdf('dashboard.eta', {
      client_name:       client.name,
      from,
      to,
      granularity_label: GRANULARITY_LABELS_ES[granularity],
      generated_date:    new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
      buckets:           aggregated.buckets,
      advisors:          aggregated.advisors,
      by_advisor:        aggregated.by_advisor,
      team_trend_image,
      ranking_image,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard_${client_id}_${from}_${to}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
