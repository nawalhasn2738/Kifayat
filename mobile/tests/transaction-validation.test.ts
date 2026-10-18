import assert from 'node:assert/strict';
import test from 'node:test';
import { transactionInputSchema } from '../src/lib/validation/transaction';

const valid = { date: '2026-10-17T12:00:00.000Z', amount: 2500, type: 'expense' as const, categoryId: 1, accountId: 1, merchant: 'Market', description: null };

test('accepts a valid whole-unit financial transaction', () => {
  assert.equal(transactionInputSchema.parse(valid).amount, 2500);
});

test('rejects zero, negative, fractional, and malformed amounts', () => {
  for (const amount of [0, -1, 1.5, Number.NaN]) assert.equal(transactionInputSchema.safeParse({ ...valid, amount }).success, false);
});

test('rejects invalid dates and identifiers', () => {
  assert.equal(transactionInputSchema.safeParse({ ...valid, date: 'not-a-date' }).success, false);
  assert.equal(transactionInputSchema.safeParse({ ...valid, accountId: 0 }).success, false);
});
