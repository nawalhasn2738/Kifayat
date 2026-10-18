import { z } from 'zod';

export const transactionInputSchema = z.object({
  date: z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), 'Enter a valid date.'),
  amount: z.number().int().positive().max(2_147_483_647),
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
