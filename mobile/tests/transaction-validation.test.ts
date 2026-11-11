import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PKR_AMOUNT, parsePkrAmount, transactionInputSchema } from '../src/lib/validation/transaction';

const valid = { date: '2026-10-17T12:00:00.000Z', amount: 2500, type: 'expense' as const, categoryId: 1, accountId: 1, merchant: 'Market', description: null };

test('accepts a valid whole-unit financial transaction', () => {
  assert.equal(transactionInputSchema.parse(valid).amount, 2500);
});

test('rejects zero, negative, fractional, and malformed amounts', () => {
  for (const amount of [0, -1, 1.5, Number.NaN]) assert.equal(transactionInputSchema.safeParse({ ...valid, amount }).success, false);
});

test('accepts only income and expense with positive caller amounts', () => {
  for (const type of ['income', 'expense']) {
    assert.equal(transactionInputSchema.safeParse({ ...valid, type, amount: 125 }).success, true);
    assert.equal(transactionInputSchema.safeParse({ ...valid, type, amount: -125 }).success, false);
  }
  for (const type of ['transfer', 'refund', 'unknown']) {
    assert.equal(transactionInputSchema.safeParse({ ...valid, type }).success, false);
  }
});
test('rejects invalid dates and identifiers', () => {
  assert.equal(transactionInputSchema.safeParse({ ...valid, date: 'not-a-date' }).success, false);
  assert.equal(transactionInputSchema.safeParse({ ...valid, accountId: 0 }).success, false);
});

test('accepts canonical UTC transaction timestamps, including leap-day boundaries', () => {
  for (const date of ['2024-02-29T00:00:00.000Z', '2026-02-28T23:59:59.999Z']) {
    assert.equal(transactionInputSchema.safeParse({ ...valid, date }).success, true);
  }
});

test('rejects impossible dates and non-canonical transaction date formats', () => {
  for (const date of ['', '2026-02-30T00:00:00.000Z', '2025-02-29T00:00:00.000Z', '2026-10-17', '2026/10/17', '2026-10-17 12:00:00', '2026-10-17T12:00:00Z']) {
    assert.equal(transactionInputSchema.safeParse({ ...valid, date }).success, false, date);
  }
});

test('strictly parses positive whole-rupee strings through the shared maximum', () => {
  assert.equal(parsePkrAmount('125'), 125);
  assert.equal(parsePkrAmount('00125'), 125);
  assert.equal(parsePkrAmount(String(MAX_PKR_AMOUNT)), MAX_PKR_AMOUNT);
  assert.equal(transactionInputSchema.parse({ ...valid, amount: MAX_PKR_AMOUNT }).amount, MAX_PKR_AMOUNT);
});

test('rejects out-of-range and malformed PKR amounts consistently', () => {
  const aboveMaximum = String(MAX_PKR_AMOUNT + 1);
  for (const raw of ['', ' ', ' 125', '125 ', '0', '-125', '+125', '125.75', '1e3', '1,000', '125PKR', aboveMaximum, '999999999999999999999999999999']) {
    assert.throws(() => parsePkrAmount(raw), /positive whole amount/);
  }
  assert.equal(transactionInputSchema.safeParse({ ...valid, amount: MAX_PKR_AMOUNT + 1 }).success, false);
});
