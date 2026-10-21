import { z } from 'zod';
import { isValidTransactionDate, MAX_PKR_AMOUNT } from '@/lib/validation/transaction';

export const transferInputSchema = z.object({
  date: z.string().refine(isValidTransactionDate, 'Enter a valid date.'),
  amount: z.number().int().positive().max(MAX_PKR_AMOUNT),
  sourceAccountId: z.number().int().positive(),
  destinationAccountId: z.number().int().positive(),
  description: z.string().trim().max(500).nullable(),
}).refine((value) => value.sourceAccountId !== value.destinationAccountId, {
  message: 'Choose two different accounts.',
  path: ['destinationAccountId'],
});

export type TransferInput = z.infer<typeof transferInputSchema>;

export function validateTransferInput(input: TransferInput) {
  return transferInputSchema.parse(input);
}

const persistedTransferSchema = z.object({
  id: z.number().int().positive(), clientId: z.string().trim().min(1),
  userId: z.number().int().positive(), date: z.string().refine(isValidTransactionDate),
  amount: z.number().int().positive().max(MAX_PKR_AMOUNT),
  sourceAccountId: z.number().int().positive(), destinationAccountId: z.number().int().positive(),
  description: z.string().max(500).nullable(),
}).refine((value) => value.sourceAccountId !== value.destinationAccountId);

export function validatePersistedTransfer<T>(value: T): T {
  const result = persistedTransferSchema.safeParse(value);
  if (!result.success) {
    const id = typeof (value as { id?: unknown })?.id === 'number' ? ` ${(value as { id: number }).id}` : '';
    throw new Error(`Invalid persisted transfer${id}.`);
  }
  return value;
}
