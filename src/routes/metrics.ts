import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryReportMetrics } from '../metrics/store';
import { aggregateMetrics, Granularity } from '../metrics/aggregate';

const router = Router();

const GRANULARITIES: [Granularity, ...Granularity[]] = [
  'weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual',
];

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
    const rows = await queryReportMetrics(client_id, from, to, advisor);
    const aggregated = aggregateMetrics(rows, granularity);
    res.json({
      client_id,
      from,
      to,
      granularity,
      advisors:   aggregated.advisors,
      buckets:    aggregated.buckets,
      team:       aggregated.team,
      by_advisor: aggregated.by_advisor,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
