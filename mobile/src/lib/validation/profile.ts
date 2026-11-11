import { MAX_PKR_AMOUNT } from './transaction';

export type FinancialProfileInput = { monthlyIncome: number; emergencyFundTarget: number };
export type ProfileField = keyof FinancialProfileInput;
const labels: Record<ProfileField, string> = { monthlyIncome: 'Monthly income', emergencyFundTarget: 'Emergency savings target' };

export function validateProfileMoney(value: unknown, field: ProfileField): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_PKR_AMOUNT) {
    throw new Error(`${labels[field]} must be a whole PKR amount from 0 to ${MAX_PKR_AMOUNT.toLocaleString('en-US')}.`);
  }
  return value;
}
export function parseProfileMoney(raw: string, field: ProfileField): number {
  if (!/^[0-9]+$/.test(raw.trim())) throw new Error(`Enter ${labels[field].toLowerCase()} as whole PKR digits. Enter 0 explicitly if it is zero.`);
  return validateProfileMoney(Number(raw.trim()), field);
}
export function validateFinancialProfile(input: FinancialProfileInput): FinancialProfileInput {
  return {
    monthlyIncome: validateProfileMoney(input?.monthlyIncome, 'monthlyIncome'),
    emergencyFundTarget: validateProfileMoney(input?.emergencyFundTarget, 'emergencyFundTarget'),
  };
}
