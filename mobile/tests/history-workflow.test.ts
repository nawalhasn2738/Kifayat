import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHistoryWorkflow,
  type HistoryWorkflowDependencies,
} from '../src/lib/services/history-workflow-core';
import type { ForecastResult } from '../src/lib/types';

const unavailable: ForecastResult = {
  status: 'insufficient_history',
  forecast: null,
  reason: 'history_start_unconfirmed',
  requiredCompleteMonths: 3,
  availableCompleteMonths: 0,
  qualifyingMonths: [],
  guidance: 'Confirm history.',
};

const ready: ForecastResult = {
  status: 'ready',
  forecast: {
    total: { blend: 100, low: 80, high: 120 },
    byCategory: {},
    method: 'existing formula',
    asOf: '2026-07-15T12:00:00.000Z',
  },
  requiredCompleteMonths: 3,
  availableCompleteMonths: 3,
  qualifyingMonths: ['2026-04', '2026-05', '2026-06'],
  guidance: 'Ready.',
};

function dependencies() {
  const calls = { reads: 0, forecasts: 0, recoveries: 0, confirmations: 0, corrections: 0 };
  const services: HistoryWorkflowDependencies = {
    getFinancialHistoryState: async () => {
      calls.reads += 1;
      return { status: 'unconfirmed', reason: 'history_start_unconfirmed', suggestion: null };
    },
    getForecast: async () => { calls.forecasts += 1; return unavailable; },
    recoverMissingProfile: async () => {
      calls.recoveries += 1;
      return {
        status: 'recovered',
        profile: { userId: 1, monthlyIncome: 0, emergencyFundTarget: 0, financialHistoryStartedAt: null },
      };
    },
    confirmHistoryStart: async () => {
      calls.confirmations += 1;
      return { status: 'confirmed', value: '2026-03-31T19:00:00.000Z' };
    },
    correctHistoryStart: async () => {
      calls.corrections += 1;
      return {
        status: 'corrected',
        previousValue: '2026-03-31T19:00:00.000Z',
        value: '2026-04-30T19:00:00.000Z',
      };
    },
  };
  return {
    calls,
    services,
  };
}

test('history workflow: read-only state preserves history and nullable forecast without writes', async () => {
  const fixture = dependencies();
  const result = await createHistoryWorkflow(fixture.services).getHistoryWorkflowState();

  assert.equal(result.status, 'loaded');
  assert.equal(result.forecast.forecast, null);
  assert.deepEqual(fixture.calls, { reads: 1, forecasts: 1, recoveries: 0, confirmations: 0, corrections: 0 });
});

test('history workflow: successful recovery propagates supplied values and refreshes state', async () => {
  const fixture = dependencies();
  let received: unknown;
  fixture.services.recoverMissingProfile = async (input: unknown) => {
    received = input;
    return {
      status: 'recovered',
      profile: { userId: 1, monthlyIncome: 0, emergencyFundTarget: 250_000, financialHistoryStartedAt: null },
    };
  };
  const result = await createHistoryWorkflow(fixture.services).recoverFinancialProfile({
    monthlyIncome: 0,
    emergencyFundTarget: 250_000,
  });

  assert.deepEqual(received, { monthlyIncome: 0, emergencyFundTarget: 250_000 });
  assert.equal(result.status, 'handled');
  assert.equal(result.outcome.status, 'recovered');
  assert.equal(result.refreshed?.status, 'loaded');
});

test('history workflow: recovery rejection is preserved and does not refresh', async () => {
  const fixture = dependencies();
  fixture.services.recoverMissingProfile = async () => ({
    status: 'rejected', reason: 'invalid_input', invalidFields: ['monthlyIncome'],
  });
  const result = await createHistoryWorkflow(fixture.services).recoverFinancialProfile({
    monthlyIncome: -1,
    emergencyFundTarget: 0,
  });

  assert.deepEqual(result, {
    status: 'handled',
    outcome: { status: 'rejected', reason: 'invalid_input', invalidFields: ['monthlyIncome'] },
    refreshed: null,
  });
  assert.equal(fixture.calls.reads, 0);
});

test('history workflow: confirmation success refreshes history and forecast readiness', async () => {
  const fixture = dependencies();
  fixture.services.getFinancialHistoryState = async () => ({
    status: 'confirmed', value: '2026-03-31T19:00:00.000Z', calendarDate: '2026-04-01',
  });
  fixture.services.getForecast = async () => ready;
  const result = await createHistoryWorkflow(fixture.services)
    .confirmFinancialHistoryStart({ calendarDate: '2026-04-01' });

  assert.equal(result.status, 'handled');
  assert.equal(result.outcome.status, 'confirmed');
  assert.equal(result.refreshed?.status, 'loaded');
  assert.equal(result.refreshed?.forecast.status, 'ready');
});

test('history workflow: stale correction remains distinct and performs no refresh', async () => {
  const fixture = dependencies();
  fixture.services.correctHistoryStart = async () => ({ status: 'rejected', reason: 'stale_value' });
  const result = await createHistoryWorkflow(fixture.services).correctFinancialHistoryStart({
    calendarDate: '2026-05-01',
    expectedCurrentValue: '2026-03-31T19:00:00.000Z',
  });

  assert.deepEqual(result, {
    status: 'handled',
    outcome: { status: 'rejected', reason: 'stale_value' },
    refreshed: null,
  });
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.forecasts, 0);
});

test('history workflow: correction success refreshes unavailable readiness without fabricating zero', async () => {
  const fixture = dependencies();
  const result = await createHistoryWorkflow(fixture.services).correctFinancialHistoryStart({
    calendarDate: '2026-05-01',
    expectedCurrentValue: '2026-03-31T19:00:00.000Z',
  });

  assert.equal(result.status, 'handled');
  assert.equal(result.outcome.status, 'corrected');
  assert.equal(result.refreshed?.status, 'loaded');
  assert.equal(result.refreshed?.forecast.forecast, null);
});

test('history workflow: unexpected service errors become stable application failures', async () => {
  const fixture = dependencies();
  fixture.services.confirmHistoryStart = async () => { throw new Error('raw database details'); };
  const action = await createHistoryWorkflow(fixture.services)
    .confirmFinancialHistoryStart({ calendarDate: '2026-04-01' });
  assert.deepEqual(action, { status: 'failed', reason: 'service_unavailable' });

  fixture.services.getFinancialHistoryState = async () => { throw new Error('raw database details'); };
  const read = await createHistoryWorkflow(fixture.services).getHistoryWorkflowState();
  assert.deepEqual(read, { status: 'failed', reason: 'service_unavailable' });
});
