import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/lib/db/schema.ts';
import { createChatRepository } from '../src/lib/repositories/chat-core.ts';
import { createCatalogRepository } from '../src/lib/repositories/catalog-core.ts';
import { createTransactionRepository } from '../src/lib/repositories/transactions-core.ts';
import { createChatContextProvider } from '../src/lib/services/chat-context-core.ts';
import { createChatSession } from '../src/lib/services/chat-session-core.ts';
import { createChatClient } from '../src/lib/services/chat-client-core.ts';
import { createMobileChatHandler } from '../../src/lib/chat/mobile-handler.ts';
import { createHistoryStartStateService } from '../src/lib/services/history-start-state-core.ts';
import { createForecastReadinessService } from '../src/lib/services/forecast-readiness-core.ts';
import { migrateWithExpoPath } from './helpers/migration-chain.mjs';

const now = new Date('2026-11-11T12:00:00.000Z');
async function fixture(run) {
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys = ON');
    await migrateWithExpoPath(sqlite);
    const database = drizzle(sqlite, { schema });
    await database.insert(schema.users).values([
      { id: 101, name: 'Mobile user', email: 'local@example.test' },
      { id: 202, name: 'Other user', email: 'other@example.test' },
    ]);
    await database.insert(schema.accounts).values([
      { id: 7, userId: 101, name: 'Local', type: 'checking', balance: 100_000 },
      { id: 8, userId: 202, name: 'Other', type: 'checking', balance: 999_999 },
    ]);
    await database.insert(schema.userProfiles).values({ userId: 101, monthlyIncome: 100_000, emergencyFundTarget: 20_000,
      financialHistoryStartedAt: '2026-07-31T19:00:00.000Z' });
    const catalogue = createCatalogRepository(database, { userId: 101 });
    const transactions = createTransactionRepository(database, { userId: 101, now: () => now });
    const history = createHistoryStartStateService(database, { userId: 101, now: () => now });
    const forecast = createForecastReadinessService({ getFinancialHistoryState: history.getFinancialHistoryState,
      listAllTransactions: transactions.listAllTransactions, now: () => now });
    const getContext = createChatContextProvider({ listAccounts: catalogue.listAccounts, listAllTransactions: transactions.listAllTransactions,
      getHistory: history.getFinancialHistoryState, getForecast: forecast, now: () => now });
    await run({ database, getContext, repository: createChatRepository(database, { userId: 101 }),
      other: createChatRepository(database, { userId: 202 }) });
  } finally { sqlite.close(); }
}

test('chat persistence: real repositories scope context and conversations to the local user', async () => {
  await fixture(async ({ database, getContext, repository, other }) => {
    await database.insert(schema.transactions).values([
      { userId: 101, accountId: 7, clientId: 'local', type: 'expense', amount: -1234, date: now.toISOString() },
      { userId: 202, accountId: 8, clientId: 'other', type: 'expense', amount: -888_888, date: now.toISOString() },
    ]);
    const context = await getContext();
    assert.equal(context.current.expense, 1234);
    assert.equal(context.balances.total, 100_000);
    assert.equal(context.balances.accountCount, 1);
    assert.ok(!JSON.stringify(context).includes('888888'));
    const localId = await repository.getOrCreateConversation();
    assert.equal(await repository.getOrCreateConversation(), localId);
    await repository.saveMessage(localId, 'user', 'My question');
    await assert.rejects(other.listMessages(localId), /unavailable/);
    await assert.rejects(other.saveMessage(localId, 'assistant', 'Intrusion'), /unavailable/);
    assert.equal((await repository.listMessages(localId)).length, 1);
  });
});

test('chat persistence: fixture SQLite to HTTP handler to persisted reply survives session reload', async () => {
  await fixture(async ({ database, getContext, repository }) => {
    await database.insert(schema.transactions).values({ userId: 101, accountId: 7, clientId: 'real-ledger', type: 'expense', amount: -4321, date: now.toISOString() });
    const handler = createMobileChatHandler(async () => '{"sentenceIds":["answer","coverage"]}');
    const chat = createChatClient({ endpoint: 'https://test.example/api/mobile-chat', getContext,
      fetch: (url, init) => handler(new Request(url, init)) });
    let state;
    const session = createChatSession({ ...repository, chat, changed: (next) => { state = next; } });
    await session.load();
    await session.send('How much did I spend this month?');
    assert.equal(state.messages.length, 2);
    assert.match(state.messages[1].content, /PKR 4,321/);
    assert.match(state.messages[1].content, /2026-11/);
    const reloaded = createChatSession({ ...repository, chat, changed: (next) => { state = next; } });
    await reloaded.load();
    assert.equal(state.messages.length, 2);
    assert.deepEqual(state.messages.map((row) => row.id), ['1', '2']);
  });
});

test('chat persistence: synchronous lock and retries prevent duplicate submissions or user records', async () => {
  await fixture(async ({ repository }) => {
    let state, calls = 0, release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const session = createChatSession({ ...repository, changed: (next) => { state = next; }, chat: async () => {
      calls++;
      await waiting;
      if (calls === 1) throw new Error('Could not reach the AI service. Check your connection and try again.');
      return { version: 1, text: 'Recorded answer', source: 'mobile_sqlite', mode: 'deterministic', asOf: now.toISOString() };
    } });
    await session.load();
    const first = session.send('How much did I spend?');
    await session.send('How much did I spend?');
    release(); await first;
    assert.equal(calls, 1);
    assert.equal(state.retryable, true);
    await Promise.all([session.retry(), session.retry()]);
    assert.equal(calls, 2);
    assert.equal(state.messages.length, 2);
    const saved = await repository.listMessages(await repository.getOrCreateConversation());
    assert.deepEqual(saved.map((row) => row.role), ['user', 'assistant']);
  });
});

test('chat persistence: assistant-save retry reuses response and history-load errors are recoverable', async () => {
  await fixture(async ({ repository }) => {
    let state, saves = 0, calls = 0, loads = 0;
    const session = createChatSession({ ...repository,
      listMessages: async (id) => { if (++loads === 1) throw new Error('Private DB details'); return repository.listMessages(id); },
      saveMessage: async (...args) => { if (++saves === 2) throw new Error('Private DB details'); return repository.saveMessage(...args); },
      changed: (next) => { state = next; }, chat: async () => { calls++; return { version: 1, text: 'Answer', source: 'mobile_sqlite', mode: 'deterministic', asOf: now.toISOString() }; },
    });
    await session.load();
    assert.equal(state.ready, false);
    assert.doesNotMatch(state.error, /Private/);
    await session.load();
    await session.send('How much did I spend?');
    assert.equal(state.retryable, true);
    await session.retry();
    assert.equal(calls, 1);
    assert.equal(state.messages.length, 2);
  });
});
