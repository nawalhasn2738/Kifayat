import { MAX_PKR_AMOUNT } from '@/lib/validation/transaction';

export const ACCOUNT_TYPES = ['checking', 'savings', 'cash'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type AccountCreationInput = {
  name: string;
  type: AccountType;
  openingBalance: number;
};

const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

export function normalizeAccountName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter an account name.');
  const name = value.trim();
  if (!name || name.length > 80 || controlCharacterPattern.test(name)) {
    throw new Error('Enter an account name between 1 and 80 characters.');
  }
  return name;
}

export function validateAccountType(value: unknown): AccountType {
  if (!ACCOUNT_TYPES.includes(value as AccountType)) throw new Error('Select a supported account type.');
  return value as AccountType;
}

export function validateOpeningBalance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_PKR_AMOUNT) {
    throw new Error('Enter a signed whole PKR opening balance within the supported range.');
  }
  return Object.is(value, -0) ? 0 : value;
}

export function validateAccountCreationInput(input: AccountCreationInput): AccountCreationInput {
  return {
    name: normalizeAccountName(input.name),
    type: validateAccountType(input.type),
    openingBalance: validateOpeningBalance(input.openingBalance),
  };
}
