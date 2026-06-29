import { dbEnabled, pool, REPORT_METRICS_TABLE } from '../config/db';
import { currentPeriodKey, keyStartDate } from '../google/drive';

// ─────────────────────────────────────────────────────────────────────────────
// Per-advisor report metrics, stored per period in PostgreSQL. This is the
// primary, robust source for "compare vs previous period": the Drive sidecars
// remain as a redundant fallback (see resolvers in the runner / report route).
//
// All functions are no-ops / return null when DATABASE_URL is not set, so the
// callers transparently fall back to the Google Drive sidecar mechanism.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stores (or replaces) one advisor's metrics + full sidecar text for a period.
 * Best-effort: on any DB error it logs and resolves, so report generation is
 * never blocked by a metrics write (Drive still has the redundant copy).
 */
export async function recordReportMetrics(
  clientId:     string,
  advisor:      string,
  periodKey:    string,
  avgScore:     number,
  pctSiguiente: number,
  talkRatio:    number,
  sidecarText:  string,
): Promise<void> {
  if (!dbEnabled) return;
  try {
    await pool!.query(
      `INSERT INTO ${REPORT_METRICS_TABLE}
         (client_id, advisor, period_key, period_start, avg_score, pct_siguiente, talk_ratio, sidecar_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (client_id, advisor, period_key) DO UPDATE SET
         period_start = EXCLUDED.period_start,
         avg_score    = EXCLUDED.avg_score,
         pct_siguiente= EXCLUDED.pct_siguiente,
         talk_ratio   = EXCLUDED.talk_ratio,
         sidecar_text = EXCLUDED.sidecar_text,
         created_at   = now()`,
      [clientId, advisor, periodKey, keyStartDate(periodKey), avgScore, pctSiguiente, talkRatio, sidecarText],
    );
  } catch (e) {
    console.warn(`[metrics] DB record failed for ${advisor} (${periodKey}):`, (e as Error).message);
  }
}

/**
 * Returns the full sidecar text of the most recent period STRICTLY BEFORE the
 * current one for an advisor, or null if the DB is disabled, has no such row, or
 * errors (so the caller falls back to Drive). The text is in the same format as
 * a Drive sidecar, so parseSidecarMetrics() works on it unchanged.
 */
export async function previousReportTextFromDb(
  clientId:   string,
  advisor:    string,
  month:      string,
  periodType: 'monthly' | 'weekly',
  dateFrom?:  string,
): Promise<string | null> {
  if (!dbEnabled) return null;
  const currentStart = keyStartDate(currentPeriodKey(month, periodType, dateFrom));
  try {
    const { rows } = await pool!.query(
      `SELECT sidecar_text FROM ${REPORT_METRICS_TABLE}
       WHERE client_id = $1 AND advisor = $2 AND period_start < $3
       ORDER BY period_start DESC LIMIT 1`,
      [clientId, advisor, currentStart],
    );
    if (rows.length && rows[0].sidecar_text) {
      console.log(`[metrics] Previous report for ${advisor} resolved from DB`);
      return rows[0].sidecar_text as string;
    }
  } catch (e) {
    console.warn(`[metrics] DB previous-report lookup failed for ${advisor}:`, (e as Error).message);
  }
  return null;
}

/**
 * Returns the most recent prior period key across the given advisors (for the
 * UI "has previous" hint), or null if the DB is disabled / has nothing / errors.
 */
export async function previousPeriodKeyFromDb(
  clientId:   string,
  advisors:   string[],
  month:      string,
  periodType: 'monthly' | 'weekly',
  dateFrom?:  string,
): Promise<string | null> {
  if (!dbEnabled || advisors.length === 0) return null;
  const currentStart = keyStartDate(currentPeriodKey(month, periodType, dateFrom));
  try {
    const { rows } = await pool!.query(
      `SELECT period_key FROM ${REPORT_METRICS_TABLE}
       WHERE client_id = $1 AND advisor = ANY($2) AND period_start < $3
       ORDER BY period_start DESC LIMIT 1`,
      [clientId, advisors, currentStart],
    );
    if (rows.length) return rows[0].period_key as string;
  } catch (e) {
    console.warn('[metrics] DB previous-period-key lookup failed:', (e as Error).message);
  }
  return null;
}
