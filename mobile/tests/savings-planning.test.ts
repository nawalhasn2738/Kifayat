import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSavingsRecommendation, calculateInstallmentSafety } from '../src/lib/finance/planning-rules';
import { goalProgress, assessRecordedInstallment } from '../src/lib/services/savings-planning-core';
import { parseGoalDate, parseGoalTarget } from '../src/lib/validation/savings-goal';
import { createSavingsGoalRunner } from '../src/lib/services/savings-goal-ui';

test('savings progress: preserves actual amount and deficit, remaining and capped display', () => {
  assert.deepEqual(goalProgress(100, 25), { current: 25, netSavings: 25, remaining: 75, percent: 25 });
  assert.deepEqual(goalProgress(100, 150), { current: 150, netSavings: 150, remaining: 0, percent: 100 });
  assert.deepEqual(goalProgress(100, -25), { current: 0, netSavings: -25, remaining: 100, percent: 0 });
  assert.deepEqual(goalProgress(100, null), { current: null, netSavings: null, remaining: null, percent: null });
  assert.throws(() => goalProgress(0, 0));
  assert.throws(() => goalProgress(100, Number.MAX_SAFE_INTEGER + 1));
});

test('savings target and date parsing: reject empty, zero, negatives, fractional, excessive and impossible dates', () => {
  for (const raw of ['', ' ', '0', '-1', '2.5', '1e6', '10,000', '2147483648']) assert.throws(() => parseGoalTarget(raw));
  assert.equal(parseGoalTarget('2147483647'), 2_147_483_647);
  assert.equal(parseGoalDate('2028-02-29'), '2028-02-28T19:00:00.000Z');
  for (const date of ['', '2026-02-29', '2026-13-01', '2026-04-31', '11/11/2026']) assert.throws(() => parseGoalDate(date));
});

test('savings recommendations: reuse 20% rule, cap to recorded headroom including zero and deficit', () => {
  assert.deepEqual(calculateSavingsRecommendation({ income: 100_000, expectedExpenses: 80_000 }), {
    targetByRule: 20_000, expectedExpenses: 80_000, headroom: 20_000, recommendedMonthlyTransfer: 20_000,
    reason: '20% of income (20000) is achievable given headroom 20000; standard 50/30/20 rule applies',
  });
  assert.equal(calculateSavingsRecommendation({ income: 100_000, expectedExpenses: 95_000 }).recommendedMonthlyTransfer, 5_000);
  for (const expectedExpenses of [100_000, 120_000]) assert.equal(calculateSavingsRecommendation({ income: 100_000, expectedExpenses }).recommendedMonthlyTransfer, 0);
  assert.equal(calculateSavingsRecommendation({ income: 0, expectedExpenses: 0 }).recommendedMonthlyTransfer, 0);
});

test('installment rule: preserves zero APR, interest arithmetic and exact 30% threshold', () => {
  const input = { income: 100_000, essentialMonthlySpend: 20_000 };
  assert.equal(calculateInstallmentSafety(input, { price: 72_000, months: 3, apr: 0 }).safe, true);
  assert.equal(calculateInstallmentSafety(input, { price: 72_001, months: 3, apr: 0 }).safe, false);
  const result = calculateInstallmentSafety(input, { price: 100_000, months: 12, apr: 0.12 });
  assert.equal(result.monthly, 8_885);
  assert.match(result.reason, /disposable 80000/);
  assert.equal(calculateInstallmentSafety({ income: 0, essentialMonthlySpend: 0 }, { price: 1, months: 1, apr: 0 }).safe, false);
});

test('installment adapter: rejects unavailable data and invalid amount, horizon and APR', () => {
  const unavailable = { analysis: { status: 'unavailable', guidance: 'History incomplete' } } as Parameters<typeof assessRecordedInstallment>[0];
  assert.throws(() => assessRecordedInstallment(unavailable, { price: 30_000, months: 3, apr: 0 }), /complete history/);
  for (const input of [{ price: 0, months: 3, apr: 0 }, { price: 100, months: 0, apr: 0 },
    { price: 100, months: 121, apr: 0 }, { price: 100, months: 1.5, apr: 0 }, { price: 100, months: 1, apr: -0.1 }, { price: 100, months: 1, apr: Infinity }]) {
    assert.throws(() => assessRecordedInstallment(unavailable, input));
  }
});

function runnerFixture() {
  const events: string[] = [];
  const runner = createSavingsGoalRunner<number>({ loading: value => events.push(`loading:${value}`), saving: value => events.push(`saving:${value}`),
    loaded: value => events.push(`loaded:${value}`), error: value => events.push(`error:${value}`), notice: value => events.push(`notice:${value}`) });
  return { runner, events };
}
test('savings UI: duplicate submission and overlapping refresh queues until saved refresh finishes', async () => {
  const { runner, events } = runnerFixture();
  let release!: () => void; let writes = 0, refreshes = 0;
  const first = runner.submit(async () => { writes++; await new Promise<void>(resolve => { release = resolve; }); }, async () => { refreshes++; return 7; });
  assert.equal(await runner.submit(async () => { writes++; }, async () => 8), null);
  await runner.load(async () => { refreshes++; return 9; });
  release(); assert.equal(await first, 'saved');
  assert.equal(writes, 1); assert.equal(refreshes, 2);
  assert.ok(events.includes('notice:Savings target saved.'));
  assert.equal(events.at(-1), 'loading:false');
});
test('savings UI: load/write failures and saved-but-refresh-failed have distinct safe feedback', async () => {
  const { runner, events } = runnerFixture();
  await runner.load(async () => { throw new Error('private SQLite error'); });
  assert.ok(events.includes('error:Could not load savings planning. Try again.'));
  assert.equal(await runner.submit(async () => { throw new Error('private SQLite error'); }, async () => 9), 'rejected');
  assert.equal(await runner.submit(async () => {}, async () => { throw new Error('private SQL'); }), 'saved_refresh_failed');
  assert.ok(events.includes('notice:Target saved, but progress could not be refreshed.'));
  assert.ok(!events.join(' ').includes('private'));
  await runner.load(async () => 1); assert.ok(events.includes('loaded:1'));
});

test('savings UI: history refresh requested during an older read publishes only the latest result', async () => {
  const { runner, events } = runnerFixture();
  let release!: (value: number) => void;
  const oldRead = runner.load(() => new Promise<number>(resolve => { release = resolve; }));
  await runner.load(async () => 2);
  release(1); await oldRead;
  assert.ok(!events.includes('loaded:1'));
  assert.ok(events.includes('loaded:2'));
});
