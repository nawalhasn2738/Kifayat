import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryWorkflow, type HistoryWorkflowActionResult, type HistoryWorkflowDependencies } from '../src/lib/services/history-workflow-core';
import { createExclusiveSubmissionGuard, createHistorySubmissionRunner, createLatestRequestCoordinator, forecastReadinessText, historyActionError, parseRecoveryPkr } from '../src/lib/services/history-workflow-ui';

const unavailable = {
  status: 'insufficient_history' as const,
  forecast: null,
  reason: 'insufficient_complete_months' as const,
  requiredCompleteMonths: 3 as const,
  availableCompleteMonths: 2,
  qualifyingMonths: ['2026-07', '2026-08'],
  guidance: '2 of 3 complete reporting months are available.',
};

function fixture(): { calls: string[]; services: HistoryWorkflowDependencies } {
  const calls: string[] = [];
  return {
    calls,
    services: {
      getFinancialHistoryState: async () => {
        calls.push('read');
        return { status: 'unconfirmed', reason: 'history_start_unconfirmed', suggestion: { value: '2026-05-31T19:00:00.000Z', calendarDate: '2026-06-01', sourceTransactionDate: '2026-06-15T00:00:00.000Z' } };
      },
      getForecast: async () => { calls.push('forecast'); return unavailable; },
      confirmHistoryStart: async (input) => { calls.push(`confirm:${input.calendarDate}`); return { status: 'confirmed', value: '2026-06-30T19:00:00.000Z' }; },
      correctHistoryStart: async (input) => { calls.push(`correct:${input.calendarDate}:${input.expectedCurrentValue}`); return { status: 'corrected', previousValue: String(input.expectedCurrentValue), value: '2026-07-31T19:00:00.000Z' }; },
      recoverMissingProfile: async (input) => { calls.push(`recover:${input.monthlyIncome}:${input.emergencyFundTarget}`); return { status: 'recovered', profile: { userId: 1, monthlyIncome: Number(input.monthlyIncome), emergencyFundTarget: Number(input.emergencyFundTarget), financialHistoryStartedAt: null } }; },
    },
  };
}

test('UI read displays an advisory suggestion without confirming or mutating financial data', async () => {
  const subject = fixture();
  const result = await createHistoryWorkflow(subject.services).getHistoryWorkflowState();
  assert.equal(result.status, 'loaded');
  assert.equal(result.status === 'loaded' && result.history.status === 'unconfirmed' ? result.history.suggestion?.calendarDate : null, '2026-06-01');
  assert.deepEqual(subject.calls, ['read', 'forecast']);
});

test('UI actions pass an alternative date, expected current value, and explicit recovery amounts', async () => {
  const subject = fixture();
  const workflow = createHistoryWorkflow(subject.services);
  await workflow.confirmFinancialHistoryStart({ calendarDate: '2026-07-01' });
  await workflow.correctFinancialHistoryStart({ calendarDate: '2026-08-01', expectedCurrentValue: '2026-06-30T19:00:00.000Z' });
  await workflow.recoverFinancialProfile({ monthlyIncome: 0, emergencyFundTarget: 250_000 });
  assert.ok(subject.calls.includes('confirm:2026-07-01'));
  assert.ok(subject.calls.includes('correct:2026-08-01:2026-06-30T19:00:00.000Z'));
  assert.ok(subject.calls.includes('recover:0:250000'));
  assert.equal(subject.calls.filter((call) => call === 'read').length, 3, 'each successful write refreshes history');
  assert.equal(subject.calls.some((call) => call.startsWith('transaction') || call.startsWith('balance')), false);
});

test('UI helpers reject invalid recovery values and explain rejected dates', () => {
  assert.equal(parseRecoveryPkr('0'), 0);
  assert.equal(parseRecoveryPkr('2147483647'), 2_147_483_647);
  for (const value of ['', '-1', '1.5', '2147483648', 'PKR 1']) assert.equal(parseRecoveryPkr(value), null);
  assert.match(historyActionError('invalid_calendar_date'), /YYYY-MM-DD/);
  assert.match(historyActionError('stale_value'), /changed since/);
});

test('UI readiness copy keeps an insufficient forecast unavailable and explains complete months', () => {
  assert.equal(unavailable.forecast, null);
  assert.match(forecastReadinessText(unavailable), /2 of 3 complete consecutive Karachi months/);
  assert.match(forecastReadinessText(unavailable), /partial month does not count/);
});

test('exclusive submission guard prevents a duplicate while allowing a later submission', async () => {
  const guard = createExclusiveSubmissionGuard();
  let release!: () => void;
  const first = guard(() => new Promise<number>((resolve) => { release = () => resolve(1); }));
  assert.equal(await guard(async () => 2), null);
  release();
  assert.equal(await first, 1);
  assert.equal(await guard(async () => 3), 3);
});
test('submission reports saved-but-stale when the facade post-write refresh fails', async () => {
  const events: string[] = [];
  const runner = createHistorySubmissionRunner({
    saving: (value) => events.push(`saving:${value}`),
    clearMessages: () => events.push('clear'),
    rejected: (message) => events.push(`error:${message}`),
    saved: (message) => events.push(`saved:${message}`),
    savedButRefreshFailed: () => events.push('saved:refresh_failed'),
    publish: () => events.push('publish'),
    invalidateReads: () => events.push('invalidate'),
  });

  await runner.submit(async () => ({
    status: 'handled',
    outcome: { status: 'confirmed', value: '2026-06-30T19:00:00.000Z' },
    refreshed: { status: 'failed', reason: 'service_unavailable' },
  }), 'History start confirmed.');

  assert.deepEqual(events, [
    'saving:true', 'clear', 'invalidate', 'saved:refresh_failed', 'saving:false',
  ]);
});

test('submission remains locked until the facade refresh result is handled', async () => {
  const saving: boolean[] = [];
  type Confirmed = { status: 'confirmed'; value: string };
  let finish!: (value: HistoryWorkflowActionResult<Confirmed>) => void;
  const runner = createHistorySubmissionRunner({
    saving: (value) => saving.push(value), clearMessages: () => {}, rejected: () => {},
    saved: () => {}, savedButRefreshFailed: () => {}, publish: () => {}, invalidateReads: () => {},
  });
  const first = runner.submit<Confirmed>(() => new Promise((resolve) => { finish = resolve; }), 'Saved.');
  assert.deepEqual(saving, [true]);
  assert.equal(await runner.submit(async () => ({ status: 'failed', reason: 'service_unavailable' }), 'Duplicate.'), null);
  assert.deepEqual(saving, [true]);
  finish({
    status: 'handled', outcome: { status: 'confirmed', value: '2026-06-30T19:00:00.000Z' },
    refreshed: { status: 'loaded', history: { status: 'unconfirmed', reason: 'history_start_unconfirmed', suggestion: null }, forecast: unavailable },
  });
  await first;
  assert.deepEqual(saving, [true, false]);
});

test('an older competing refresh cannot overwrite published post-write state', async () => {
  const applied: string[] = [];
  let finishOld!: (value: string) => void;
  const coordinator = createLatestRequestCoordinator<string>({
    loading: () => {}, loaded: (value) => applied.push(value), failed: () => {},
  });
  const older = coordinator.load(() => new Promise((resolve) => { finishOld = resolve; }));
  coordinator.invalidate();
  coordinator.publish('new post-write state');
  finishOld('stale pre-write state');
  assert.equal((await older).status, 'stale');
  assert.deepEqual(applied, ['new post-write state']);
});

test('rejected and thrown submissions show errors and always release the guard', async () => {
  const events: string[] = [];
  const runner = createHistorySubmissionRunner({
    saving: (value) => events.push(`saving:${value}`), clearMessages: () => {},
    rejected: (message) => events.push(`error:${message}`), saved: () => {},
    savedButRefreshFailed: () => {}, publish: () => {}, invalidateReads: () => {},
  });
  await runner.submit(async () => ({
    status: 'handled', outcome: { status: 'rejected', reason: 'invalid_calendar_date' }, refreshed: null,
  }), 'Saved.');
  await runner.submit(async () => { throw new Error('raw failure'); }, 'Saved.');
  await runner.submit(async () => ({
    status: 'handled', outcome: { status: 'rejected', reason: 'no_change' }, refreshed: null,
  }), 'Saved.');

  assert.equal(events.filter((event) => event === 'saving:true').length, 3);
  assert.equal(events.filter((event) => event === 'saving:false').length, 3);
  assert.ok(events.some((event) => event.includes('YYYY-MM-DD')));
  assert.ok(events.some((event) => event.includes('temporarily unavailable')));
  assert.ok(events.some((event) => event.includes('different date')));
});