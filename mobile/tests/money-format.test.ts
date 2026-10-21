import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPKR, formatTransactionPKR, transactionAmountTone } from '../src/lib/finance/money-format';
import { MAX_PKR_AMOUNT } from '../src/lib/validation/transaction';

test('money formatting preserves positive, zero, and negative signs', () => {
  assert.equal(formatPKR(1_234), 'PKR 1,234');
  assert.equal(formatPKR(0), 'PKR 0');
  assert.equal(formatPKR(-0), 'PKR 0');
  assert.equal(formatPKR(-1_234), 'PKR -1,234');
});

test('money formatting preserves grouping at supported boundaries', () => {
  assert.equal(formatPKR(MAX_PKR_AMOUNT), 'PKR 2,147,483,647');
  assert.equal(formatPKR(-MAX_PKR_AMOUNT), 'PKR -2,147,483,647');
  assert.equal(formatPKR(Number.MAX_SAFE_INTEGER), 'PKR 9,007,199,254,740,991');
});

test('money formatting rejects decimal, non-finite, unsafe, and unavailable values', () => {
  for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => formatPKR(value as number), /safe integer amount/);
  }
});

test('transaction formatting separates direction from magnitude explicitly', () => {
  assert.equal(formatTransactionPKR(1_250), '+PKR 1,250');
  assert.equal(formatTransactionPKR(-1_250), '−PKR 1,250');
  assert.equal(formatTransactionPKR(0), 'PKR 0');
});

test('transaction presentation tone follows the signed ledger amount', () => {
  assert.equal(transactionAmountTone('income', 100), 'positive');
  assert.equal(transactionAmountTone('income', -100), 'negative');
  assert.equal(transactionAmountTone('expense', 100), 'positive');
  assert.equal(transactionAmountTone('expense', -100), 'negative');
  assert.equal(transactionAmountTone('transfer', 100), 'positive');
  assert.equal(transactionAmountTone('transfer', -100), 'negative');
  assert.equal(transactionAmountTone('transfer', 0), 'neutral');
});
