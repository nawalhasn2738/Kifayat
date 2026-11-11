import assert from 'node:assert/strict';
import test from 'node:test';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core';
import type { FinancialHistoryState } from '../src/lib/services/history-start-state-core';
import type { Transaction } from '../src/lib/types';

const asOf = new Date('2026-07-15T12:00:00.000Z');
const aprilStart = '2026-03-31T19:00:00.000Z';

function transaction(amount: number, date: string): Transaction {
  return {
    id: Math.abs(amount), clientId: `${date}-${amount}`, date, amount, type: 'expense',
    merchant: null, description: null, isAnomaly: false, category: null,
    account: { id: 1, name: 'Test', type: 'checking' },
  };
}

function service(
  history: FinancialHistoryState,
  transactions: Transaction[] = [],
  now = asOf,
) {
  return createForecastReadinessService({
    getFinancialHistoryState: async () => history,
    listAllTransactions: async () => transactions,
    now: () => now,
  });
}

test('forecast readiness: missing profile fails closed without reading transactions', async () => {
  let reads = 0;
  const getForecast = createForecastReadinessService({
    getFinancialHistoryState: async () => ({ status: 'missing_profile' }),
    listAllTransactions: async () => { reads += 1; return []; },
    now: () => asOf,
  });

  const result = await getForecast();
  assert.equal(result.status, 'insufficient_history');
  assert.equal(result.forecast, null);
  assert.equal(result.reason, 'invalid_history_start');
  assert.equal(reads, 0);
});

test('forecast readiness: unconfirmed history returns guidance and no number', async () => {
  const result = await service({
    status: 'unconfirmed', reason: 'history_start_unconfirmed', suggestion: null,
  })();

  assert.equal(result.status, 'insufficient_history');
  assert.equal(result.reason, 'history_start_unconfirmed');
  assert.equal(result.forecast, null);
  assert.match(result.guidance, /confirm/i);
});

test('forecast readiness: invalid history and invalid transactions fail closed', async () => {
  const invalidHistory = await service({ status: 'invalid', reason: 'invalid_history_start' })();
  assert.equal(invalidHistory.status, 'insufficient_history');
  assert.equal(invalidHistory.reason, 'invalid_history_start');
  assert.equal(invalidHistory.forecast, null);

  const invalidTransactions = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [transaction(-100, 'not-a-date')],
  )();
  assert.equal(invalidTransactions.status, 'insufficient_history');
  assert.equal(invalidTransactions.reason, 'invalid_history_start');
  assert.equal(invalidTransactions.forecast, null);

  const repositoryRejection = await createForecastReadinessService({
    getFinancialHistoryState: async () => ({
      status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01',
    }),
    listAllTransactions: async () => { throw new Error('Invalid persisted transaction date.'); },
    now: () => asOf,
  })();
  assert.equal(repositoryRejection.status, 'insufficient_history');
  assert.equal(repositoryRejection.reason, 'invalid_history_start');
  assert.equal(repositoryRejection.forecast, null);
});

test('forecast readiness: fewer than three complete preceding months is insufficient', async () => {
  const result = await service({
    status: 'confirmed', value: '2026-04-30T19:00:00.000Z', calendarDate: '2026-05-01',
  })();

  assert.equal(result.status, 'insufficient_history');
  assert.equal(result.reason, 'insufficient_complete_months');
  assert.equal(result.availableCompleteMonths, 2);
  assert.deepEqual(result.qualifyingMonths, ['2026-05', '2026-06']);
  assert.equal(result.forecast, null);
});

test('forecast readiness: exactly three complete months preserve the existing formula', async () => {
  const result = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [
      transaction(-100, '2026-04-10T12:00:00.000Z'),
      transaction(-200, '2026-05-10T12:00:00.000Z'),
      transaction(-300, '2026-06-10T12:00:00.000Z'),
      transaction(-9_000, '2026-07-01T12:00:00.000Z'),
    ],
  )();

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.qualifyingMonths, ['2026-04', '2026-05', '2026-06']);
  assert.deepEqual(result.forecast.total, { blend: 200, low: 118, high: 282 });
});

test('forecast readiness: complete empty months count as zero activity', async () => {
  const result = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [
      transaction(-90, '2026-04-10T12:00:00.000Z'),
      transaction(-210, '2026-06-10T12:00:00.000Z'),
    ],
  )();

  assert.equal(result.status, 'ready');
  assert.equal(result.forecast.total.blend, 100);
  assert.deepEqual(result.qualifyingMonths, ['2026-04', '2026-05', '2026-06']);
});

test('forecast readiness: a partial current month never counts or affects the forecast', async () => {
  const withoutCurrent = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [transaction(-300, '2026-06-10T12:00:00.000Z')],
  )();
  const withCurrent = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [transaction(-300, '2026-06-10T12:00:00.000Z'), transaction(-90_000, '2026-07-15T12:00:00.000Z')],
  )();

  assert.deepEqual(withCurrent, withoutCurrent);
});

test('forecast readiness: Karachi boundary selects the new current month exactly', async () => {
  const history = { status: 'confirmed', value: '2026-01-31T19:00:00.000Z', calendarDate: '2026-02-01' } as const;
  const beforeBoundary = await service(history, [], new Date('2026-04-30T18:59:59.999Z'))();
  const atBoundary = await service(history, [], new Date('2026-04-30T19:00:00.000Z'))();

  assert.equal(beforeBoundary.status, 'insufficient_history');
  assert.deepEqual(beforeBoundary.qualifyingMonths, ['2026-02', '2026-03']);
  assert.equal(atBoundary.status, 'ready');
  assert.deepEqual(atBoundary.qualifyingMonths, ['2026-02', '2026-03', '2026-04']);
});

test('forecast readiness: deleting earliest or all transactions does not change confirmed readiness', async () => {
  const history = { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' } as const;
  const withEarliest = await service(history, [transaction(-100, '2026-04-01T00:00:00.000Z')])();
  const afterDeletion = await service(history, [])();

  assert.equal(withEarliest.status, 'ready');
  assert.equal(afterDeletion.status, 'ready');
  assert.deepEqual(afterDeletion.qualifyingMonths, withEarliest.qualifyingMonths);
  assert.deepEqual(afterDeletion.forecast.total, { blend: 0, low: 0, high: 0 });
});

test('forecast readiness: every unavailable result carries null and consumer guidance', async () => {
  const results = await Promise.all([
    service({ status: 'missing_profile' })(),
    service({ status: 'transaction_history_invalid' })(),
    service({ status: 'unconfirmed', reason: 'history_start_unconfirmed', suggestion: null })(),
  ]);

  for (const result of results) {
    assert.equal(result.status, 'insufficient_history');
    assert.equal(result.forecast, null);
    assert.ok(result.guidance.length > 0);
  }
});
test('forecast readiness: category estimates use the same complete months with zero-filled gaps', async () => {
  const categorized = (amount: number, date: string, id: number, name: string) => ({
    ...transaction(amount, date),
    category: { id, name },
  });
  const result = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [
      categorized(-90, '2026-04-10T12:00:00.000Z', 1, 'groceries'),
      categorized(-210, '2026-06-10T12:00:00.000Z', 1, 'groceries'),
      categorized(-30, '2026-04-11T12:00:00.000Z', 2, 'transport'),
      categorized(-60, '2026-05-11T12:00:00.000Z', 2, 'transport'),
      categorized(-90, '2026-06-11T12:00:00.000Z', 2, 'transport'),
      transaction(-15, '2026-05-12T12:00:00.000Z'),
      categorized(-99_999, '2026-07-01T12:00:00.000Z', 3, 'current_month_only'),
      { ...categorized(50_000, '2026-05-12T12:00:00.000Z', 4, 'income_category'), type: 'income' as const },
      { ...categorized(40_000, '2026-05-12T12:00:00.000Z', 5, 'transfer_category'), type: 'transfer' as const },
    ],
  )();

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.forecast.byCategory, {
    groceries: { blend: 100, low: 14, high: 186 },
    transport: { blend: 60, low: 36, high: 84 },
    uncategorized: { blend: 5, low: 0, high: 12 },
  });
  assert.deepEqual(result.forecast.total, { blend: 165, low: 68, high: 262 });
  assert.equal(result.forecast.method, '3-month mean ± population standard deviation using complete Karachi months');
});

test('forecast readiness: zero spending produces a zero total without fabricated categories', async () => {
  const result = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [],
  )();

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.forecast.total, { blend: 0, low: 0, high: 0 });
  assert.deepEqual(result.forecast.byCategory, {});
});

test('forecast readiness: real uncategorized category stays distinct from missing categories', async () => {
  const result = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [
      { ...transaction(-90, '2026-04-10T12:00:00.000Z'), category: { id: 7, name: 'uncategorized' } },
      transaction(-30, '2026-04-11T12:00:00.000Z'),
    ],
  )();

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.forecast.byCategory, {
    uncategorized: { blend: 10, low: 0, high: 24 },
    'uncategorized [category 7]': { blend: 30, low: 0, high: 72 },
  });
  assert.equal(result.forecast.total.blend, 40);
});

test('forecast readiness: category window is start-inclusive at the Karachi month boundary', async () => {
  const result = await service(
    { status: 'confirmed', value: aprilStart, calendarDate: '2026-04-01' },
    [
      { ...transaction(-9_000, '2026-03-31T18:59:59.999Z'), category: { id: 1, name: 'groceries' } },
      { ...transaction(-90, '2026-03-31T19:00:00.000Z'), category: { id: 1, name: 'groceries' } },
    ],
  )();

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.qualifyingMonths, ['2026-04', '2026-05', '2026-06']);
  assert.deepEqual(result.forecast.byCategory, {
    groceries: { blend: 30, low: 0, high: 72 },
  });
  assert.equal(result.forecast.total.blend, 30);
});
