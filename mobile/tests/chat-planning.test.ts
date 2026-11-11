import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatContextProvider } from '../src/lib/services/chat-context-core';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core';
import { createAffordabilityService } from '../src/lib/services/affordability-core';
import { buildAnswerPlan, parseChatRequest, renderAnswer, type ChatMessage } from '../src/lib/chat/contract';
import { planningIntent } from '../src/lib/chat/planning';
import { calculateForecast } from '../src/lib/services/finance-core';
import type { Transaction } from '../src/lib/types';
const cutoff = new Date('2026-11-11T12:00:00.000Z');
function tx(amount: number, type: Transaction['type'], date = cutoff.toISOString(), category = 'groceries'): Transaction {
  return { id: 1, clientId: 'private', amount, type, date, merchant: 'Private merchant', description: 'Private description', isAnomaly: false,
    account: { id: 7, name: 'Private account', type: 'checking' }, category: { id: category === 'fuel' ? 2 : 1, name: category } };
}

function fixture(balance = 100_000, confirmed = true, empty = false, eligible = true, missingProfile = false) {
  const accounts = [{ id: 7, name: 'Private account', type: 'checking', balance }];
  const transactions = empty ? [] : [tx(50_000, 'income', '2026-08-02T12:00:00.000Z'),
    tx(-10_000, 'expense', '2026-08-02T12:00:00.000Z'), tx(-20_000, 'expense', '2026-09-02T12:00:00.000Z', 'fuel'),
    tx(-30_000, 'expense', '2026-10-02T12:00:00.000Z'), tx(-999_999, 'expense'), tx(999_999, 'transfer')];
  const getHistory = async () => confirmed
    ? { status: 'confirmed' as const, value: '2026-07-31T19:00:00.000Z', calendarDate: '2026-08-01' }
    : { status: 'unconfirmed' as const, reason: 'history_start_unconfirmed' as const, suggestion: null };
  const getForecast = createForecastReadinessService({ now: () => cutoff, getFinancialHistoryState: getHistory, listAllTransactions: async () => transactions });
  const getContext = createChatContextProvider({ now: () => cutoff, listAccounts: async () => accounts,
    listAllTransactions: async () => transactions, getHistory, getForecast,
    getAffordability: (input, _asOf, snapshot) => createAffordabilityService({
      getSummary: async () => snapshot.summary, getForecast: async () => snapshot.forecast,
      getProfile: async () => { if (missingProfile) throw new Error('Private profile error'); return { emergencyFundTarget: 70_000 }; },
      listActiveAccounts: async () => eligible ? accounts : [],
    })(input),
  });
  const ask = async (content: string, prior: ChatMessage[] = []) => {
    const messages: ChatMessage[] = [...prior, { role: 'user', content }];
    const context = await getContext(messages);
    const request = parseChatRequest({ version: 1, messages, context });
    return { context, answer: renderAnswer(buildAnswerPlan(request)) };
  };
  return { ask, transactions };
}

test('planning chat: forecast amounts and rankings reuse service; current partial month and transfers excluded', async () => {
  const { ask, transactions } = fixture();
  const { context, answer } = await ask('Which categories are expected to cost me the most next month?');
  const result = context.planning!.forecast;
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(result.forecast, calculateForecast(transactions, cutoff, ['2026-08', '2026-09', '2026-10']));
  assert.match(answer, new RegExp(`PKR ${result.forecast.total.blend.toLocaleString('en-US')}`));
  assert.match(answer, /current partial month is excluded/);
  assert.match(answer, /not a calibrated probability or guaranteed/);
  const sorted = Object.entries(result.forecast.byCategory).sort(([, a], [, b]) => b.blend - a.blend);
  assert.ok(answer.indexOf(JSON.stringify(sorted[0][0])) < answer.indexOf(JSON.stringify(sorted[1][0])));
  for (const secret of ['Private', 'merchant', 'description', 'clientId']) assert.ok(!JSON.stringify(context).includes(secret));
});

test('planning chat: confirmed empty history gives zero forecast, unconfirmed history gives reason and no predicted amount', async () => {
  const ready = await fixture(100_000, true, true).ask('What is my forecast?');
  assert.match(ready.answer, /PKR 0/);
  assert.match(ready.answer, /eligible empty months count as zero/);
  const unavailable = await fixture(100_000, false).ask('Why can\'t the app provide a forecast yet?');
  assert.match(unavailable.answer, /history_start_unconfirmed/);
  assert.doesNotMatch(unavailable.answer, /PKR/);
});

test('planning chat: affordability and buffer exactly preserve service results for sufficient and insufficient funds', async () => {
  for (const balance of [200_000, 10_000]) {
    const { context, answer } = await fixture(balance).ask('Can I afford PKR 30,000 in 2 months?');
    const assessment = context.planning!.affordability!;
    assert.equal(assessment.status, 'ready');
    if (assessment.status !== 'ready') continue;
    assert.equal(assessment.result.buffer, 70_000);
    assert.equal(assessment.result.canAfford, balance === 200_000);
    assert.ok(answer.includes(assessment.result.reason));
    assert.ok(answer.includes(`PKR ${assessment.result.available.toLocaleString('en-US')}`));
  }
});

test('planning chat: missing profile, eligible accounts and history fail closed', async () => {
  for (const service of [fixture(100_000, true, false, false), fixture(100_000, true, false, true, true), fixture(100_000, false)]) {
    const { answer } = await service.ask('Can I afford PKR 30,000 in 2 months?');
    assert.match(answer, /No affordability conclusion/);
    assert.doesNotMatch(answer, /purchase preserves/);
  }
});

test('planning chat: missing inputs, delay follow-up, horizon boundaries and immediate limitation', async () => {
  const service = fixture();
  assert.match((await service.ask('Can I afford PKR 30,000?')).answer, /how many months/);
  assert.match((await service.ask('Can I afford a purchase in 2 months?')).answer, /purchase amount/);
  const prior: ChatMessage[] = [{ role: 'user', content: 'Can I afford PKR 30,000?' }, { role: 'assistant', content: 'In how many months?' }];
  const followup = await service.ask('What if I wait two months?', prior);
  assert.deepEqual(followup.context.planning!.purchase, { price: 30_000, monthsAhead: 2 });
  assert.match(followup.answer, /purchase of PKR 30,000 in 2 months/);
  for (const months of [0, 121]) assert.match((await service.ask(`Can I afford PKR 30,000 in ${months} months?`)).answer, /1 to 120/);
  assert.match((await service.ask('Can I afford PKR 30,000 now?')).answer, /zero months/);
  for (const months of [1, 120]) assert.equal(planningIntent([{ role: 'user', content: `Can I afford PKR 30,000 in ${months} months?` }]).purchase?.monthsAhead, months);
});

test('planning chat: invalid AI claims and omitted planning warnings use the original local fallback', async () => {
  const { createChatClient } = await import('../src/lib/services/chat-client-core');
  const { createMobileChatHandler } = await import('../../src/lib/chat/mobile-handler');
  const service = fixture();
  const messages: ChatMessage[] = [{ role: 'user', content: 'Can I afford PKR 30,000 in 2 months?' }];
  const { context } = await service.ask(messages[0].content);
  const expected = renderAnswer(buildAnswerPlan(parseChatRequest({ version: 1, messages, context })));
  const client = createChatClient({ endpoint: 'https://test.example/api/mobile-chat', getContext: async () => context,
    fetch: async () => Response.json({ version: 1, source: 'mobile_sqlite', asOf: context.asOf, mode: 'model_selected', text: 'You can spend PKR 999,999.' }) });
  assert.equal((await client(messages)).text, expected);
  const handler = createMobileChatHandler(async () => JSON.stringify({ sentenceIds: ['answer'] }));
  const response = await handler(new Request('https://test.example/api/mobile-chat', { method: 'POST', body: JSON.stringify({ version: 1, messages, context }) }));
  const body = await response.json();
  assert.equal(body.mode, 'deterministic');
  assert.equal(body.text, expected);
  const contaminated = structuredClone(context);
  (contaminated.planning!.affordability as unknown as Record<string, unknown>).accounts = [{ name: 'Private account' }];
  assert.throws(() => parseChatRequest({ version: 1, messages, context: contaminated }));
});

test('planning chat: ambiguous or malformed purchase amounts are clarified, expense forecasts do not claim income predictions', async () => {
  const service = fixture();
  for (const amount of ['30,00', '30,000.50', '0', '2147483648', '100 or PKR 200']) {
    assert.match((await service.ask(`Can I afford PKR ${amount} in 2 months?`)).answer, /positive whole-PKR/);
  }
  assert.match(planningIntent([{ role: 'user', content: 'Can I afford PKR 30,000.' }]).clarification!, /how many months/);
  assert.match((await service.ask('What is my expected income next month?')).answer, /Income and savings forecasts are not supported/);
});
