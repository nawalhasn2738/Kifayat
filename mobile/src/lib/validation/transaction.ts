import { z } from 'zod';

export const MAX_PKR_AMOUNT = 2_147_483_647;

const positiveWholePkrPattern = /^[0-9]+$/;
const canonicalUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Accepts only the canonical UTC instant format already stored by transaction mutations. */
export function isValidTransactionDate(value: string): boolean {
  if (!canonicalUtcTimestampPattern.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Parses a complete PKR amount. Leading zeros are accepted; no invalid characters are removed. */
export function parsePkrAmount(raw: string): number {
  if (!positiveWholePkrPattern.test(raw)) throw new Error('Enter a positive whole amount using digits only.');
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_PKR_AMOUNT) throw new Error('Enter a positive whole amount within the supported range.');
  return amount;
}

export const transactionInputSchema = z.object({
  date: z.string().refine(isValidTransactionDate, 'Enter a valid date.'),
  amount: z.number().int().positive().max(MAX_PKR_AMOUNT),
  type: z.enum(['income', 'expense']),
  categoryId: z.number().int().positive().nullable(),
  accountId: z.number().int().positive(),
  merchant: z.string().trim().max(100).nullable(),
  description: z.string().trim().max(500).nullable(),
});
export type TransactionInput = z.infer<typeof transactionInputSchema>;

export function validateTransactionInput(input: TransactionInput) {
  return transactionInputSchema.parse(input);
}
