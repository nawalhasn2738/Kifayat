import type { Transaction } from '@/lib/types';

function requirePkrInteger(value: number) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('PKR formatting requires a safe integer amount.');
  }
  return Object.is(value, -0) ? 0 : value;
}

export function formatPKR(value: number) {
  return `PKR ${requirePkrInteger(value).toLocaleString('en-PK')}`;
}

export function formatTransactionPKR(amount: number) {
  const signedAmount = requirePkrInteger(amount);
  const direction = signedAmount > 0 ? '+' : signedAmount < 0 ? '−' : '';
  return `${direction}PKR ${Math.abs(signedAmount).toLocaleString('en-PK')}`;
}

export function transactionAmountTone(_type: Transaction['type'], amount: number) {
  const signedAmount = requirePkrInteger(amount);
  return signedAmount > 0 ? 'positive' : signedAmount < 0 ? 'negative' : 'neutral';
}
