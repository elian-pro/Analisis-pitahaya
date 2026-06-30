import type { ReportMetricRow } from './store';

// ─────────────────────────────────────────────────────────────────────────────
// Pure aggregation of raw report_metrics rows into time buckets at a chosen
// granularity. No DB access here — takes rows, returns buckets + series, so
// it is trivially testable (see aggregate.test.ts).
//
// The 3 metrics (avg_score, pct_siguiente, talk_ratio) are aggregated with a
// SIMPLE average within each bucket: report_metrics has no call_count column,
// so there is no volume to weight by (Sprint 0 / plan Anexo).
// ─────────────────────────────────────────────────────────────────────────────

export type Granularity =
  | 'weekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual';

export interface Bucket {
  key:   string; // sortable, e.g. '2026-06', '2026-Q2', '2026-S1', '2026'
  start: string; // YYYY-MM-DD, inclusive
  end:   string; // YYYY-MM-DD, inclusive
  label: string; // human readable, e.g. 'Jun 2026', 'Q2 2026', 'S1 2026', '2026'
}

export interface SeriesPoint {
  bucket:        string; // Bucket.key
  avg_score:     number | null;
  pct_siguiente: number | null;
  talk_ratio:    number | null;
  count:         number; // raw rows averaged into this point
}

export interface AggregatedMetrics {
  buckets:    Bucket[];
  advisors:   string[];
  team:       SeriesPoint[];
  by_advisor: Record<string, SeriesPoint[]>;
}

export const GRANULARITY_LABELS_ES: Record<Granularity, string> = {
  weekly:     'Semanal',
  monthly:    'Mensual',
  bimonthly:  'Bimestral',
  quarterly:  'Trimestral',
  semiannual: 'Semestral',
  annual:     'Anual',
};

const MONTH_LABELS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

// Last day of a given (1-indexed) month.
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

interface BucketDef {
  key:   string;
  start: { year: number; month1: number; day: number };
  end:   { year: number; month1: number; day: number };
  label: string;
}

// Derives the bucket a given period_start ('YYYY-MM-DD') belongs to, for a
// given granularity. period_start is always the real start of the analysed
// period (Sprint 0, Ticket 0.2), so it is safe to bucket directly on it.
function bucketFor(periodStart: string, granularity: Granularity): BucketDef {
  const [yearStr, monthStr, dayStr] = periodStart.split('-');
  const year  = Number(yearStr);
  const month = Number(monthStr); // 1-indexed
  const day   = Number(dayStr);

  switch (granularity) {
    case 'weekly': {
      // ISO week: Monday-start. Find the Monday on/before periodStart.
      const d = new Date(Date.UTC(year, month - 1, day));
      const isoDow = (d.getUTCDay() + 6) % 7; // 0 = Monday
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - isoDow);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const key = `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
      return {
        key,
        start: { year: monday.getUTCFullYear(), month1: monday.getUTCMonth() + 1, day: monday.getUTCDate() },
        end:   { year: sunday.getUTCFullYear(), month1: sunday.getUTCMonth() + 1, day: sunday.getUTCDate() },
        label: `Semana del ${pad2(monday.getUTCDate())}/${pad2(monday.getUTCMonth() + 1)}`,
      };
    }
    case 'monthly': {
      return {
        key:   `${year}-${pad2(month)}`,
        start: { year, month1: month, day: 1 },
        end:   { year, month1: month, day: lastDayOfMonth(year, month) },
        label: `${MONTH_LABELS[month - 1]} ${year}`,
      };
    }
    case 'bimonthly': {
      const group  = Math.floor((month - 1) / 2); // 0..5
      const startM = group * 2 + 1;
      const endM   = startM + 1;
      return {
        key:   `${year}-B${group + 1}`,
        start: { year, month1: startM, day: 1 },
        end:   { year, month1: endM, day: lastDayOfMonth(year, endM) },
        label: `${MONTH_LABELS[startM - 1]}-${MONTH_LABELS[endM - 1]} ${year}`,
      };
    }
    case 'quarterly': {
      const q      = Math.floor((month - 1) / 3) + 1; // 1..4
      const startM = (q - 1) * 3 + 1;
      const endM   = startM + 2;
      return {
        key:   `${year}-Q${q}`,
        start: { year, month1: startM, day: 1 },
        end:   { year, month1: endM, day: lastDayOfMonth(year, endM) },
        label: `Q${q} ${year}`,
      };
    }
    case 'semiannual': {
      const half   = month <= 6 ? 1 : 2;
      const startM = half === 1 ? 1 : 7;
      const endM   = half === 1 ? 6 : 12;
      return {
        key:   `${year}-S${half}`,
        start: { year, month1: startM, day: 1 },
        end:   { year, month1: endM, day: lastDayOfMonth(year, endM) },
        label: `S${half} ${year}`,
      };
    }
    case 'annual': {
      return {
        key:   `${year}`,
        start: { year, month1: 1, day: 1 },
        end:   { year, month1: 12, day: 31 },
        label: `${year}`,
      };
    }
  }
}

function bucketDefToBucket(def: BucketDef): Bucket {
  return {
    key:   def.key,
    start: ymd(def.start.year, def.start.month1, def.start.day),
    end:   ymd(def.end.year, def.end.month1, def.end.day),
    label: def.label,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

function aggregateGroup(rows: ReportMetricRow[]): Omit<SeriesPoint, 'bucket'> {
  return {
    avg_score:     average(rows.map(r => r.avg_score).filter((v): v is number => v !== null)),
    pct_siguiente: average(rows.map(r => r.pct_siguiente).filter((v): v is number => v !== null)),
    talk_ratio:    average(rows.map(r => r.talk_ratio).filter((v): v is number => v !== null)),
    count:         rows.length,
  };
}

/**
 * Buckets raw report_metrics rows by granularity and produces two views:
 *   - team:       one point per bucket, averaging across all advisors.
 *   - by_advisor: one point per bucket and advisor.
 *
 * Buckets with no rows are not emitted (sparse series) — with a single data
 * point this still returns exactly one bucket with one point, and an empty
 * `rows` array returns empty buckets/series without throwing.
 */
export function aggregateMetrics(rows: ReportMetricRow[], granularity: Granularity): AggregatedMetrics {
  const bucketDefs = new Map<string, BucketDef>();
  const rowsByBucket = new Map<string, ReportMetricRow[]>();
  const rowsByBucketAdvisor = new Map<string, Map<string, ReportMetricRow[]>>();
  const advisors = new Set<string>();

  for (const row of rows) {
    advisors.add(row.advisor);
    const def = bucketFor(row.period_start, granularity);
    if (!bucketDefs.has(def.key)) bucketDefs.set(def.key, def);

    if (!rowsByBucket.has(def.key)) rowsByBucket.set(def.key, []);
    rowsByBucket.get(def.key)!.push(row);

    if (!rowsByBucketAdvisor.has(row.advisor)) rowsByBucketAdvisor.set(row.advisor, new Map());
    const perBucket = rowsByBucketAdvisor.get(row.advisor)!;
    if (!perBucket.has(def.key)) perBucket.set(def.key, []);
    perBucket.get(def.key)!.push(row);
  }

  const sortedKeys = [...bucketDefs.keys()].sort(
    (a, b) => bucketDefToBucket(bucketDefs.get(a)!).start.localeCompare(bucketDefToBucket(bucketDefs.get(b)!).start),
  );
  const buckets = sortedKeys.map(k => bucketDefToBucket(bucketDefs.get(k)!));

  const team: SeriesPoint[] = sortedKeys.map(key => ({
    bucket: key,
    ...aggregateGroup(rowsByBucket.get(key)!),
  }));

  const by_advisor: Record<string, SeriesPoint[]> = {};
  for (const advisor of [...advisors].sort()) {
    const perBucket = rowsByBucketAdvisor.get(advisor) ?? new Map();
    by_advisor[advisor] = sortedKeys
      .filter(key => perBucket.has(key))
      .map(key => ({ bucket: key, ...aggregateGroup(perBucket.get(key)!) }));
  }

  return { buckets, advisors: [...advisors].sort(), team, by_advisor };
}
