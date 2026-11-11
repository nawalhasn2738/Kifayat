import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardController } from '../src/lib/services/dashboard-ui';
import type { Dashboard } from '../src/lib/services/dashboard-core';
import { dashboardTrend } from '../src/lib/services/dashboard-core';
import { riskBandForScore, calculateEmergencyBuffer, createSummaryService } from '../src/lib/services/finance-core';

test('dashboard: SRS risk labels preserve inclusive 30 and 60 boundaries', () => {
  for (const [score, band] of [[0, 'low'], [29, 'low'], [30, 'low'], [31, 'moderate'], [59, 'moderate'], [60, 'moderate'], [61, 'high'], [100, 'high']] as const) assert.equal(riskBandForScore(score), band);
  assert.equal(calculateEmergencyBuffer(20_000, 70_000), 70_000);
  assert.equal(calculateEmergencyBuffer(20_000, 0), 60_000);
  assert.throws(() => calculateEmergencyBuffer(Number.MAX_SAFE_INTEGER, 0));
});

test('dashboard trends: year/leap rollover, confirmed empty months and unknown months remain distinct', async () => {
  const asOf = new Date('2028-03-01T00:00:00.000Z');
  const summary = await createSummaryService({ listAccounts: async () => [], listAllTransactions: async () => [], now: () => asOf })();
  const history = { status: 'confirmed' as const, value: '2027-12-31T19:00:00.000Z', calendarDate: '2028-01-01' };
  const rows = dashboardTrend(summary, history, asOf);
  assert.deepEqual(rows.map(row => row.month), ['2027-09', '2027-10', '2027-11', '2027-12', '2028-01', '2028-02']);
  assert.equal(rows[3].income, null); assert.equal(rows[4].income, 0); assert.equal(rows[5].expense, 0);
  assert.ok(dashboardTrend(summary, null, asOf).every(row => row.income === null && row.expense === null));
});

test('dashboard refresh: latest focus or mutation refresh wins and blur ignores in-flight data', async () => {
  const data = (asOf: string) => ({ asOf } as Dashboard);
  let release!: (value: Dashboard) => void, calls = 0;
  const controller = createDashboardController({ changed: () => {}, load: async () => { calls++; if (calls === 1) return new Promise(resolve => { release = resolve; }); return data('fresh'); } });
  const old = controller.refresh(); await controller.refresh(); release(data('stale')); await old;
  assert.equal(controller.getState().data!.asOf, 'fresh');
  let releaseBlur!: (value: Dashboard) => void;
  const blurred = createDashboardController({ changed: () => {}, load: () => new Promise(resolve => { releaseBlur = resolve; }) });
  const pending = blurred.refresh(); blurred.invalidate(); releaseBlur(data('stale')); await pending;
  assert.equal(blurred.getState().data, null);
});

test('dashboard refresh: failures hide old figures, preserve safe error feedback and allow retry', async () => {
  let fail = false;
  const controller = createDashboardController({ changed: () => {}, load: async () => { if (fail) throw new Error('private SQL'); return { asOf: 'ok' } as Dashboard; } });
  await controller.refresh(); fail = true; await controller.refresh();
  assert.equal(controller.getState().data, null); assert.match(controller.getState().error!, /before relying/);
  assert.doesNotMatch(controller.getState().error!, /private/);
  fail = false; await controller.refresh(); assert.equal(controller.getState().error, null);
});
