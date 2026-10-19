import { listAccounts, listCategories } from '@/lib/repositories/catalog';
import { OverdraftConfirmationRequiredError, type TransactionMutationOptions } from '@/lib/repositories/transactions-core';
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from '@/lib/repositories/transactions';
import { getAffordability, getForecast, getRisk, getSummary } from '@/lib/services/finance';
import type { TransactionInput } from '@/lib/validation/transaction';

export const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL?.replace(/\/$/, '') ?? '';
export const API_URL = 'Local SQLite';
export const api = {
  summary: getSummary, risk: getRisk, forecast: getForecast, categories: listCategories, accounts: listAccounts,
  transactions: async (_page = 1, pageSize = 100) => ({ items: await listTransactions(pageSize), total: (await listTransactions(5000)).length, page: 1, pageSize }),
  transaction: async (id: number) => { const tx = await getTransaction(id); if (!tx) throw new Error('Transaction not found.'); return tx; },
  createTransaction: (input: TransactionInput, options?: TransactionMutationOptions) => createTransaction(input, options),
  updateTransaction: (id: number, input: TransactionInput, options?: TransactionMutationOptions) => updateTransaction(id, input, options),
  deleteTransaction,
  affordability: getAffordability,
  chat: async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    if (!AI_PROXY_URL) throw new Error('AI chat needs a secure backend URL. Local finance features remain available offline.');
    const response = await fetch(`${AI_PROXY_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? 'Chat is temporarily unavailable.');
    return body as { text: string };
  },
};
export { OverdraftConfirmationRequiredError };
export type { TransactionMutationOptions };
export const formatPKR = (value: number) => `PKR ${Math.abs(Math.round(value)).toLocaleString('en-PK')}`;
