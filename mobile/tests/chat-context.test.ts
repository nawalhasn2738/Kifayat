import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatContextProvider } from '../src/lib/services/chat-context-core';
import { buildAnswerPlan, renderAnswer } from '../src/lib/chat/contract';
import type { ChatContextDependencies } from '../src/lib/services/chat-context-core';
import type { Transaction } from '../src/lib/types';

export const cutoff = new Date('2026-11-11T12:00:00.000Z');
export function tx(amount: number, type: Transaction['type'], date = '2026-11-02T12:00:00.000Z', category = 'groceries'): Transaction {
  return { id: 1, clientId: String(amount), date, amount, type, merchant: 'Private merchant', description: 'Private description', isAnomaly: false,
    account: { id: 7, name: 'Private account', type: 'checking' }, category: { id: 1, name: category } };
}
export function contextFixture(overrides: Partial<ChatContextDependencies> = {}) {
  return createChatContextProvider({
    now: () => cutoff,
    listAccounts: async () => [{ id: 7, name: 'Private account', type: 'checking', balance: 90_000 }],
    listAllTransactions: async () => [tx(100_000, 'income'), tx(-10_000, 'expense'), tx(-20_000, 'expense', '2026-10-03T12:00:00.000Z')],
    getHistory: async () => ({ status: 'confirmed', value: '2026-07-31T19:00:00.000Z', calendarDate: '2026-08-01' }),
    getForecast: async () => ({ status: 'ready', requiredCompleteMonths: 3, availableCompleteMonths: 3, qualifyingMonths: ['2026-08', '2026-09', '2026-10'],
      guidance: 'Ready', forecast: { total: { blend: 1, low: 0, high: 2 }, byCategory: {}, method: 'test', asOf: cutoff.toISOString() } }),
    ...overrides,
  })();
}

test('chat context: owned current and previous totals reuse finance rules and disclose aggregates only', async () => {
  const context = await contextFixture();
  assert.equal(context.current.income, 100_000);
  assert.equal(context.current.expense, 10_000);
  assert.equal(context.current.savings, 90_000);
  assert.equal(context.previous.expense, 20_000);
  assert.deepEqual(context.current.categories, [{ name: 'groceries', total: 10_000 }]);
  assert.equal(context.current.start, '2026-10-31T19:00:00.000Z');
  assert.equal(context.current.endExclusive, '2026-11-30T19:00:00.000Z');
  assert.equal(context.previous.through, '2026-10-31T18:59:59.999Z');
  for (const secret of ['Private', 'merchant', 'description', 'clientId', 'userId']) assert.ok(!JSON.stringify(context).includes(secret));
});

test('chat context: Karachi boundaries, exact cutoff, future exclusion and transfer exclusion', async () => {
  const context = await contextFixture({ listAllTransactions: async () => [
    tx(-1, 'expense', '2026-10-31T18:59:59.999Z'), tx(-2, 'expense', '2026-10-31T19:00:00.000Z'),
    tx(-3, 'expense', cutoff.toISOString()), tx(-4, 'expense', '2026-11-11T12:00:00.001Z'),
    tx(-900, 'transfer'), tx(900, 'transfer'),
  ] });
  assert.equal(context.current.expense, 5);
  assert.equal(context.previous.expense, 1);
  assert.equal(context.current.income, 0);
  assert.equal(context.current.savings, -5);
});

test('chat context: incomplete, unconfirmed and unavailable history never claim complete zero spending', async () => {
  for (const history of [
    { status: 'confirmed' as const, value: '2026-11-04T19:00:00.000Z', calendarDate: '2026-11-05' },
    { status: 'unconfirmed' as const, reason: 'history_start_unconfirmed' as const, suggestion: null },
    { status: 'missing_profile' as const },
  ]) {
    const context = await contextFixture({ getHistory: async () => history, listAllTransactions: async () => [],
      getForecast: async () => ({ status: 'insufficient_history', forecast: null, reason: 'history_start_unconfirmed',
        requiredCompleteMonths: 3, availableCompleteMonths: 0, qualifyingMonths: [], guidance: 'Unavailable' }) });
    assert.notEqual(context.current.coverage, 'complete');
    const answer = renderAnswer(buildAnswerPlan({ version: 1, messages: [{ role: 'user', content: 'How much did I spend this month?' }], context }));
    assert.match(answer, /incomplete|unconfirmed|unavailable/i);
    assert.doesNotMatch(answer, /History is confirmed/);
  }
});

test('chat context: empty accounts and transactions are explicit and mismatched account relationships fail closed', async () => {
  const context = await contextFixture({ listAccounts: async () => [], listAllTransactions: async () => [] });
  assert.equal(context.balances.accountCount, 0);
  assert.equal(context.current.expense, 0);
  assert.match(renderAnswer(buildAnswerPlan({ version: 1, messages: [{ role: 'user', content: 'How much did I spend?' }], context })), /No local accounts/);
  await assert.rejects(contextFixture({ listAccounts: async () => [] }), /need attention/);
});

test('chat answers: all first-slice questions, ties, missing categories and comparison qualify the period', async () => {
  const context = await contextFixture();
  const examples = [
    ['How much did I spend this month?', /expenses.*PKR 10,000/],
    ['What is my biggest spending category?', /groceries.*PKR 10,000/],
    ['How much did I save this month?', /PKR 90,000.*PKR 100,000.*PKR 10,000/],
    ['How much income did I receive?', /income.*PKR 100,000/],
    ['How much did I spend on groceries?', /groceries.*PKR 10,000/],
    ['Compare my spending with the previous complete month.', /difference is PKR -10,000/],
  ] as const;
  for (const [content, expected] of examples) {
    const answer = renderAnswer(buildAnswerPlan({ version: 1, messages: [{ role: 'user', content }], context }));
    assert.match(answer, expected);
    assert.match(answer, /Asia\/Karachi/);
    assert.match(answer, /2026-11/);
  }
  const comparison = renderAnswer(buildAnswerPlan({ version: 1, messages: [{ role: 'user', content: examples[5][0] }], context }));
  assert.match(comparison, /not equal-duration/);
  assert.match(comparison, /2026-10/);
  const tied = await contextFixture({ listAllTransactions: async () => [tx(-4, 'expense'), tx(-4, 'expense', undefined, 'fuel')] });
  assert.match(renderAnswer(buildAnswerPlan({ version: 1, messages: [{ role: 'user', content: examples[1][0] }], context: tied })), /fuel.*groceries.*PKR 4.*each/);
  const empty = await contextFixture({ listAllTransactions: async () => [] });
  const ask = (content: string) => renderAnswer(buildAnswerPlan({ version: 1, messages: [{ role: 'user', content }], context: empty }));
  assert.match(ask('How much did I spend on groceries last month?'), /2026-10.*groceries.*PKR 0/);
  assert.match(ask('What is my biggest spending category?'), /no recorded expenses/);
  assert.match(ask('How much did I spend on an unknown category?'), /could not match/);
});

test('chat context: year rollover and leap-month reporting boundaries use the Karachi calendar', async () => {
  for (const [date, currentMonth, previousMonth, end] of [
    ['2027-01-01T00:00:00.000Z', '2027-01', '2026-12', '2027-01-31T19:00:00.000Z'],
    ['2028-02-29T12:00:00.000Z', '2028-02', '2028-01', '2028-02-29T19:00:00.000Z'],
  ]) {
    const context = await contextFixture({ now: () => new Date(date), listAllTransactions: async () => [] });
    assert.equal(context.current.month, currentMonth);
    assert.equal(context.previous.month, previousMonth);
    assert.equal(context.current.endExclusive, end);
  }
});
