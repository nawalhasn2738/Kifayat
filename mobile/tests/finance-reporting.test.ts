import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateForecast, calculateRisk, createSummaryService, monthly } from '../src/lib/services/finance-core';
import type { Transaction } from '../src/lib/types';

const now = new Date('2026-10-19T12:00:00.000Z');

function transaction(amount: number, type: Transaction['type'], date = '2026-10-10T12:00:00.000Z'): Transaction {
  return {
    id: Math.abs(amount), clientId: `${type}-${date}-${amount}`, date, amount, type,
    merchant: null, description: null, isAnomaly: false, category: null,
    account: { id: 1, name: 'Test Account', type: 'checking' },
  };
}

async function summary(
  transactions: Transaction[] = [],
  accounts: { name: string; type: string; balance: number }[] = [],
  asOf = now,
) {
  return createSummaryService({
    listAccounts: async () => accounts,
    listAllTransactions: async (...args: never[]) => {
      assert.deepEqual(args, []);
      return transactions;
    },
    now: () => asOf,
  })(asOf);
}

test('finance reporting: savings and rate equal income minus expenses for the same month', async () => {
  const result = await summary([
    transaction(100_000, 'income'),
    transaction(-70_000, 'expense'),
  ]);

  assert.equal(result.savings.thisMonth, 30_000);
  assert.equal(result.savings.threeMonthAvg, 30_000);
  assert.equal(result.savings.rate, 0.3);
});

test('finance reporting: savings are negative when expenses exceed income', async () => {
  const result = await summary([
    transaction(50_000, 'income'),
    transaction(-65_000, 'expense'),
  ]);

  assert.equal(result.savings.thisMonth, -15_000);
  assert.equal(result.savings.threeMonthAvg, -15_000);
  assert.equal(result.savings.rate, -0.3);
});

test('finance reporting: legacy transfer rows do not affect income, expenses, savings, or rate', async () => {
  const result = await summary([
    transaction(100_000, 'income'),
    transaction(-70_000, 'expense'),
    transaction(500_000, 'transfer'),
    transaction(-400_000, 'transfer'),
  ]);

  assert.equal(result.income.thisMonth, 100_000);
  assert.equal(result.spend.thisMonthMTD, 70_000);
  assert.equal(result.savings.thisMonth, 30_000);
  assert.equal(result.savings.rate, 0.3);
});

test('finance reporting: zero income preserves a zero finite savings rate', async () => {
  const result = await summary([transaction(-65_000, 'expense')]);

  assert.equal(result.savings.thisMonth, -65_000);
  assert.equal(result.savings.rate, 0);
  assert.equal(Number.isFinite(result.savings.rate), true);
});

test('finance reporting: monthly savings remain isolated by reporting bucket', async () => {
  const result = await summary([
    transaction(100_000, 'income', '2026-10-10T12:00:00.000Z'),
    transaction(-70_000, 'expense', '2026-10-11T12:00:00.000Z'),
    transaction(50_000, 'income', '2026-09-10T12:00:00.000Z'),
    transaction(-65_000, 'expense', '2026-09-11T12:00:00.000Z'),
  ]);

  assert.deepEqual(result.monthlyTotals.map(({ month, income, expense, savings }) => ({ month, income, expense, savings })), [
    { month: '2026-09', income: 50_000, expense: 65_000, savings: -15_000 },
    { month: '2026-10', income: 100_000, expense: 70_000, savings: 30_000 },
  ]);
  assert.equal(result.savings.thisMonth, 30_000);
});

test('finance reporting: buckets exact Karachi boundaries as start-inclusive and end-exclusive', () => {
  const result = monthly([
    transaction(100, 'income', '2026-04-30T18:59:59.999Z'),
    transaction(200, 'income', '2026-04-30T19:00:00.000Z'),
    transaction(-40, 'expense', '2026-05-31T18:59:59.999Z'),
    transaction(-80, 'expense', '2026-05-31T19:00:00.000Z'),
  ]);

  assert.deepEqual(result, [
    { month: '2026-04', income: 100, expense: 0, savings: 100 },
    { month: '2026-05', income: 200, expense: 40, savings: 160 },
    { month: '2026-06', income: 0, expense: 80, savings: -80 },
  ]);
});

test('finance reporting: current and previous Karachi months do not depend on the host timezone', async () => {
  const original = process.env.TZ;
  const asOf = new Date('2026-04-30T20:00:00.000Z');
  const transactions = [
    transaction(100, 'income', '2026-04-30T18:59:59.999Z'),
    transaction(200, 'income', '2026-04-30T19:00:00.000Z'),
    transaction(-50, 'expense', '2026-04-30T19:30:00.000Z'),
  ];

  try {
    process.env.TZ = 'UTC';
    const utcHost = await summary(transactions, [], asOf);
    process.env.TZ = 'America/Los_Angeles';
    const pacificHost = await summary(transactions, [], asOf);

    assert.deepEqual(pacificHost, utcHost);
    assert.equal(utcHost.income.lastMonth, 100);
    assert.equal(utcHost.income.thisMonth, 200);
    assert.equal(utcHost.spend.thisMonthMTD, 50);
    assert.deepEqual(utcHost.topCategoriesMTD, [{ category: 'uncategorized', total: 50, count: 1 }]);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('finance reporting: empty data preserves zero-valued summary behavior', async () => {
  const result = await summary();

  assert.deepEqual(result.monthlyTotals, []);
  assert.equal(result.income.thisMonth, 0);
  assert.equal(result.spend.thisMonthMTD, 0);
  assert.deepEqual(result.savings, { thisMonth: 0, threeMonthAvg: 0, rate: 0 });
  assert.equal(result.totalBalance, 0);
});
async function assertUnsafeReportingRejectsWithoutMutation(
  transactions: Transaction[] = [],
  accounts: { name: string; type: string; balance: number }[] = [],
) {
  const transactionsBefore = structuredClone(transactions);
  const accountsBefore = structuredClone(accounts);
  await assert.rejects(summary(transactions, accounts), /safe integer monetary values/i);
  assert.deepEqual(transactions, transactionsBefore);
  assert.deepEqual(accounts, accountsBefore);
}

test('finance reporting: summary includes transactions beyond the former 5,000-row limit', async () => {
  const transactions = Array.from({ length: 5_001 }, (_, index) => ({
    ...transaction(1, 'income'),
    id: index + 1,
    clientId: `complete-history-${index}`,
  }));

  const result = await summary(transactions);
  assert.equal(result.income.thisMonth, 5_001);
  assert.equal(result.savings.thisMonth, 5_001);
});
test('finance reporting: accepts monetary aggregates exactly at both safe-integer boundaries', async () => {
  const upper = await summary([
    transaction(Number.MAX_SAFE_INTEGER - 1, 'income'),
    transaction(1, 'income'),
  ]);
  assert.equal(upper.income.thisMonth, Number.MAX_SAFE_INTEGER);
  assert.equal(upper.savings.thisMonth, Number.MAX_SAFE_INTEGER);

  const lower = await summary([], [
    { name: 'Lower A', type: 'checking', balance: Number.MIN_SAFE_INTEGER + 1 },
    { name: 'Lower B', type: 'cash', balance: -1 },
  ]);
  assert.equal(lower.totalBalance, Number.MIN_SAFE_INTEGER);
});

test('finance reporting: rejects monthly accumulation above the upper safe-integer boundary', async () => {
  await assertUnsafeReportingRejectsWithoutMutation([
    transaction(Number.MAX_SAFE_INTEGER, 'income'),
    transaction(1, 'income'),
  ]);

  await assertUnsafeReportingRejectsWithoutMutation([
    { ...transaction(-Number.MAX_SAFE_INTEGER, 'expense'), category: { id: 1, name: 'Unsafe Category' } },
    { ...transaction(-1, 'expense'), category: { id: 1, name: 'Unsafe Category' } },
  ]);
});

test('finance reporting: rejects account aggregation outside both safe-integer boundaries', async () => {
  await assertUnsafeReportingRejectsWithoutMutation([], [
    { name: 'Upper A', type: 'checking', balance: Number.MAX_SAFE_INTEGER },
    { name: 'Upper B', type: 'cash', balance: 1 },
  ]);
  await assertUnsafeReportingRejectsWithoutMutation([], [
    { name: 'Lower A', type: 'checking', balance: Number.MIN_SAFE_INTEGER },
    { name: 'Lower B', type: 'cash', balance: -1 },
  ]);
});

test('finance reporting: rejects unsafe savings subtraction from individually safe monthly totals', async () => {
  await assertUnsafeReportingRejectsWithoutMutation([
    transaction(Number.MIN_SAFE_INTEGER, 'income'),
    transaction(-1, 'expense'),
  ]);
});

test('finance reporting: rejects an unsafe individual monetary value before aggregation', async () => {
  await assertUnsafeReportingRejectsWithoutMutation([
    transaction(Number.MAX_SAFE_INTEGER + 1, 'income'),
  ]);
});

test('finance reporting: excludes later same-month actuals and includes a transaction exactly at asOf', async () => {
  const result = await summary([
    transaction(100, 'income', '2026-10-19T12:00:00.000Z'),
    transaction(900, 'income', '2026-10-19T12:00:00.001Z'),
    { ...transaction(-40, 'expense', '2026-10-20T00:00:00.000Z'), category: { id: 1, name: 'Future' } },
  ]);

  assert.equal(result.income.thisMonth, 100);
  assert.equal(result.savings.thisMonth, 100);
  assert.deepEqual(result.topCategoriesMTD, []);
  assert.deepEqual(result.monthlyTotals, [{ month: '2026-10', income: 100, expense: 0, savings: 100 }]);
});

test('finance reporting: excludes a future month from forecast inputs', () => {
  const result = calculateForecast([
    transaction(-100, 'expense', '2026-09-10T12:00:00.000Z'),
    transaction(-10_000, 'expense', '2026-11-10T12:00:00.000Z'),
  ], now);

  assert.deepEqual(result.total, { blend: 100, low: 100, high: 100 });
  assert.equal(result.asOf, now.toISOString());
});

test('finance reporting: future high-risk anomalies do not affect risk, while eligible ones do', async () => {
  const eligible = { ...transaction(-100, 'expense', '2026-10-10T12:00:00.000Z'), category: { id: 2, name: 'Ordinary' } };
  const futureRisk = { ...transaction(-900, 'expense', '2026-10-20T12:00:00.000Z'), isAnomaly: true, category: { id: 1, name: 'High Risk' } };
  const eligibleRisk = { ...futureRisk, date: now.toISOString(), clientId: 'eligible-risk' };
  const reportSummary = await summary([eligible, futureRisk]);
  const profile = { monthlyIncome: 1_000 };
  const categories = [{ id: 1, isHighRisk: true }, { id: 2, isHighRisk: false }];

  const withoutFuture = calculateRisk(reportSummary, profile, categories, [eligible], now);
  const withFuture = calculateRisk(reportSummary, profile, categories, [eligible, futureRisk], now);
  const withEligibleRisk = calculateRisk(reportSummary, profile, categories, [eligible, eligibleRisk], now);

  assert.deepEqual(withFuture, withoutFuture);
  assert.ok(withEligibleRisk.score > withoutFuture.score);
});

test('finance risk: uses the current partial Karachi month and two preceding complete months', async () => {
  const asOf = new Date('2027-01-15T10:00:00.000Z');
  const reportSummary = await summary([], [], asOf);
  const profile = { monthlyIncome: 1_000 };
  const categories = [{ id: 1, isHighRisk: true }, { id: 2, isHighRisk: false }];
  const ordinary = { ...transaction(-100, 'expense', asOf.toISOString()), category: { id: 2, name: 'Ordinary' } };
  const riskAt = (date: string) => calculateRisk(reportSummary, profile, categories, [
    ordinary,
    { ...transaction(-100, 'expense', date), clientId: `risk-${date}`, category: { id: 1, name: 'High Risk' } },
  ], asOf).score;

  // January 2027 in Karachi starts at 2026-12-31T19:00Z, so the approved
  // three-month risk window starts at Karachi midnight on November 1.
  assert.equal(riskAt('2026-10-31T18:59:59.999Z'), 20);
  assert.equal(riskAt('2026-10-31T19:00:00.000Z'), 28);
  assert.equal(riskAt('2027-01-15T09:59:59.999Z'), 28);
  assert.equal(riskAt(asOf.toISOString()), 28);
  assert.equal(riskAt('2027-01-15T10:00:00.001Z'), 20);
});

test('finance risk: volatility uses the same three Karachi months and zero-fills an empty month', async () => {
  const asOf = new Date('2027-01-15T10:00:00.000Z');
  const inWindow = [
    transaction(-100, 'expense', '2026-11-10T12:00:00.000Z'),
    transaction(-100, 'expense', '2027-01-10T12:00:00.000Z'),
  ];
  const outsideWindow = transaction(-100, 'expense', '2026-10-10T12:00:00.000Z');
  const withoutOutside = await summary(inWindow, [], asOf);
  const withOutside = await summary([outsideWindow, ...inWindow], [], asOf);
  const risk = (reportSummary: Awaited<ReturnType<typeof summary>>) => calculateRisk(
    reportSummary,
    { monthlyIncome: 10_000 },
    [],
    [outsideWindow, ...inWindow],
    asOf,
  );

  assert.deepEqual(risk(withOutside), risk(withoutOutside));
  assert.ok(risk(withOutside).reasons.includes('Spending has varied significantly recently.'));
});

test('finance risk: Karachi window selection is independent of the runtime timezone', async () => {
  const original = process.env.TZ;
  const asOf = new Date('2027-01-15T10:00:00.000Z');
  const reportSummary = await summary([], [], asOf);
  const transactions = [
    { ...transaction(-100, 'expense', asOf.toISOString()), category: { id: 2, name: 'Ordinary' } },
    { ...transaction(-100, 'expense', '2026-10-31T19:00:00.000Z'), category: { id: 1, name: 'High Risk' } },
  ];
  const run = () => calculateRisk(
    reportSummary,
    { monthlyIncome: 1_000 },
    [{ id: 1, isHighRisk: true }],
    transactions,
    asOf,
  );

  try {
    process.env.TZ = 'UTC';
    const utcHost = run();
    process.env.TZ = 'America/Los_Angeles';
    const pacificHost = run();

    assert.deepEqual(pacificHost, utcHost);
    assert.equal(utcHost.score, 28);
    assert.deepEqual(utcHost.reasons, ['Savings are below the 20% target.']);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
