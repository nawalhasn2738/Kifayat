import assert from 'node:assert/strict';
import test from 'node:test';
import { createAffordabilityService } from '../src/lib/services/affordability-core';
import type { ForecastResult, Summary } from '../src/lib/types';

const readyForecast: ForecastResult = {
  status: 'ready',
  forecast: {
    total: { blend: 0, low: 0, high: 0 },
    byCategory: {},
    method: 'test',
    asOf: '2026-08-01T00:00:00.000Z',
  },
  requiredCompleteMonths: 3,
  availableCompleteMonths: 3,
  qualifyingMonths: ['2026-05', '2026-06', '2026-07'],
  guidance: 'Three complete reporting months are available.',
};

function summary(): Summary {
  return {
    asOf: '2026-08-01T00:00:00.000Z',
    balances: [],
    totalBalance: 999_999,
    income: { thisMonth: 0, lastMonth: 0, threeMonthAvg: 0 },
    spend: { thisMonthMTD: 0, thisMonthProjected: 0, lastMonth: 0, threeMonthAvg: 999_999 },
    savings: { thisMonth: 0, threeMonthAvg: 999_999, rate: 0 },
    topCategoriesMTD: [],
    monthlyTotals: [
      { month: '2026-05', income: 40_000, expense: 20_000, savings: 20_000 },
      { month: '2026-06', income: 30_000, expense: 20_000, savings: 10_000 },
      { month: '2026-07', income: 20_000, expense: 20_000, savings: 0 },
      { month: '2026-08', income: 900_000, expense: 1, savings: 899_999 },
    ],
  };
}

test('affordability service uses owned active checking and savings without mutating inputs', async () => {
  const accounts = [
    { id: 1, name: 'Checking', type: 'checking', balance: 80_000 },
    { id: 2, name: 'Savings', type: 'savings', balance: 40_000 },
    { id: 3, name: 'Cash', type: 'cash', balance: 500_000 },
  ];
  const before = structuredClone(accounts);
  const assess = createAffordabilityService({
    getSummary: async () => summary(),
    getProfile: async () => ({ emergencyFundTarget: 90_000 }),
    getForecast: async () => readyForecast,
    listActiveAccounts: async () => accounts,
  });

  const assessment = await assess({ itemName: 'Laptop', price: 20_000, monthsAhead: 1 });
  assert.equal(assessment.status, 'ready');
  if (assessment.status !== 'ready') return;
  assert.deepEqual(assessment.accounts.map(({ id, name, type, balance }) => ({ id, name, type, balance })), before.slice(0, 2));
  assert.equal(assessment.eligibleBalance, 120_000);
  assert.equal(assessment.averageMonthlySpend, 20_000);
  assert.equal(assessment.averageMonthlySavings, 10_000);
  assert.equal(assessment.result.buffer, 90_000);
  assert.equal(assessment.result.available, 40_000);
  assert.equal(assessment.result.remainingAfterPurchase, 110_000);
  assert.equal(assessment.result.canAfford, true);
  assert.deepEqual(accounts, before);
});

test('affordability service fails closed before reading balances when history is incomplete', async () => {
  let financialReads = 0;
  const assess = createAffordabilityService({
    getSummary: async () => { financialReads += 1; return summary(); },
    getProfile: async () => { financialReads += 1; return { emergencyFundTarget: 90_000 }; },
    getForecast: async () => ({
      status: 'insufficient_history',
      forecast: null,
      reason: 'insufficient_complete_months',
      requiredCompleteMonths: 3,
      availableCompleteMonths: 2,
      qualifyingMonths: ['2026-06', '2026-07'],
      guidance: '2 of 3 complete reporting months are available.',
    }),
    listActiveAccounts: async () => { financialReads += 1; return []; },
  });

  const assessment = await assess({ itemName: 'Laptop', price: 20_000, monthsAhead: 1 });
  assert.deepEqual(assessment, {
    status: 'insufficient_history',
    result: null,
    guidance: '2 of 3 complete reporting months are available.',
    availableCompleteMonths: 2,
    requiredCompleteMonths: 3,
  });
  assert.equal(financialReads, 0);
});

test('affordability service requires an eligible active liquid account', async () => {
  const assess = createAffordabilityService({
    getSummary: async () => summary(),
    getProfile: async () => ({ emergencyFundTarget: 90_000 }),
    getForecast: async () => readyForecast,
    listActiveAccounts: async () => [{ id: 3, name: 'Cash', type: 'cash', balance: 500_000 }],
  });
  assert.deepEqual(await assess({ itemName: 'Laptop', price: 20_000, monthsAhead: 1 }), {
    status: 'insufficient_information',
    result: null,
    guidance: 'Add or restore an active checking or savings account before assessing a purchase.',
  });
});
