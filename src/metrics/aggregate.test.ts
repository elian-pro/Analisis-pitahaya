import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMetrics } from './aggregate';
import type { ReportMetricRow } from './store';

function row(advisor: string, period_start: string, avg_score: number, pct_siguiente: number, talk_ratio: number): ReportMetricRow {
  return { advisor, period_key: period_start.slice(0, 7), period_start, avg_score, pct_siguiente, talk_ratio };
}

test('empty input returns empty buckets and series without throwing', () => {
  const result = aggregateMetrics([], 'monthly');
  assert.deepEqual(result.buckets, []);
  assert.deepEqual(result.advisors, []);
  assert.deepEqual(result.team, []);
  assert.deepEqual(result.by_advisor, {});
});

test('a single data point produces exactly one bucket with one point', () => {
  const rows = [row('Ana', '2026-06-01', 80, 60, 40)];
  const result = aggregateMetrics(rows, 'monthly');
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].key, '2026-06');
  assert.equal(result.buckets[0].label, 'Jun 2026');
  assert.equal(result.team.length, 1);
  assert.deepEqual(result.team[0], { bucket: '2026-06', avg_score: 80, pct_siguiente: 60, talk_ratio: 40, count: 1 });
  assert.deepEqual(result.by_advisor['Ana'], [
    { bucket: '2026-06', avg_score: 80, pct_siguiente: 60, talk_ratio: 40, count: 1 },
  ]);
});

test('monthly granularity averages multiple advisors per bucket with a simple average', () => {
  const rows = [
    row('Ana', '2026-06-01', 80, 60, 40),
    row('Beto', '2026-06-01', 60, 40, 60),
  ];
  const result = aggregateMetrics(rows, 'monthly');
  assert.equal(result.team.length, 1);
  assert.equal(result.team[0].avg_score, 70);
  assert.equal(result.team[0].pct_siguiente, 50);
  assert.equal(result.team[0].talk_ratio, 50);
  assert.equal(result.team[0].count, 2);
  assert.equal(result.by_advisor['Ana'][0].avg_score, 80);
  assert.equal(result.by_advisor['Beto'][0].avg_score, 60);
});

test('several months bucket independently and sort chronologically', () => {
  const rows = [
    row('Ana', '2026-07-01', 90, 70, 30),
    row('Ana', '2026-05-01', 70, 50, 50),
    row('Ana', '2026-06-01', 80, 60, 40),
  ];
  const result = aggregateMetrics(rows, 'monthly');
  assert.deepEqual(result.buckets.map(b => b.key), ['2026-05', '2026-06', '2026-07']);
  assert.deepEqual(result.team.map(p => p.avg_score), [70, 80, 90]);
});

test('bimonthly, quarterly, semiannual and annual granularities group correctly', () => {
  const rows = [
    row('Ana', '2026-01-01', 10, 10, 10),
    row('Ana', '2026-02-01', 20, 20, 20),
    row('Ana', '2026-03-01', 30, 30, 30),
    row('Ana', '2026-07-01', 40, 40, 40),
  ];

  const bimonthly = aggregateMetrics(rows, 'bimonthly');
  assert.deepEqual(bimonthly.buckets.map(b => b.key), ['2026-B1', '2026-B2', '2026-B4']);
  assert.equal(bimonthly.team.find(p => p.bucket === '2026-B1')!.avg_score, 15); // avg(10,20)

  const quarterly = aggregateMetrics(rows, 'quarterly');
  assert.deepEqual(quarterly.buckets.map(b => b.key), ['2026-Q1', '2026-Q3']);
  assert.equal(quarterly.team.find(p => p.bucket === '2026-Q1')!.avg_score, 20); // avg(10,20,30)

  const semiannual = aggregateMetrics(rows, 'semiannual');
  assert.deepEqual(semiannual.buckets.map(b => b.key), ['2026-S1', '2026-S2']);

  const annual = aggregateMetrics(rows, 'annual');
  assert.deepEqual(annual.buckets.map(b => b.key), ['2026']);
  assert.equal(annual.team[0].avg_score, 25); // avg(10,20,30,40)
});

test('weekly granularity buckets by ISO week (Monday start)', () => {
  // 2026-06-29 is a Monday; 2026-07-01 falls in the same ISO week.
  const rows = [
    row('Ana', '2026-06-29', 10, 10, 10),
    row('Ana', '2026-07-01', 30, 30, 30),
  ];
  const result = aggregateMetrics(rows, 'weekly');
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].key, '2026-06-29');
  assert.equal(result.buckets[0].end, '2026-07-05');
  assert.equal(result.team[0].avg_score, 20);
});

test('mixed granularities do not crash and missing-metric rows do not poison the average', () => {
  const rows: ReportMetricRow[] = [
    row('Ana', '2026-06-01', 80, 60, 40),
    { advisor: 'Beto', period_key: '2026-06', period_start: '2026-06-01', avg_score: null, pct_siguiente: 70, talk_ratio: null },
  ];
  const result = aggregateMetrics(rows, 'monthly');
  assert.equal(result.team[0].avg_score, 80); // only Ana's non-null value counted
  assert.equal(result.team[0].pct_siguiente, 65); // avg(60, 70)
  assert.equal(result.team[0].count, 2);
});
