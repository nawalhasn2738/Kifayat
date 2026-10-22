import { listAccounts, listActiveAccounts, listCategories } from '@/lib/repositories/catalog';
import { archiveAccount, createAccount, deleteUnusedAccount, listManagedAccounts, renameAccount, restoreAccount } from '@/lib/repositories/accounts';
import { CategoryApplicabilityError, OverdraftConfirmationRequiredError, type CategoryApplicabilityErrorCode, type TransactionCreationOptions, type TransactionMutationOptions } from '@/lib/repositories/transactions-core';
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from '@/lib/repositories/transactions';
import { getAffordability, getForecast, getRisk, getSummary } from '@/lib/services/finance';
import {
  confirmFinancialHistoryStart,
  correctFinancialHistoryStart,
  getHistoryWorkflowState,
  recoverFinancialProfile,
} from '@/lib/services/history-workflow';
import type { TransactionInput } from '@/lib/validation/transaction';
import { createTransfer, deleteTransfer, getTransfer, listTransfers, updateTransfer } from '@/lib/repositories/transfers';
import type { TransferInput } from '@/lib/validation/transfer';
import { confirmOpeningBalance, correctOpeningBalance, getOpeningBalanceState } from '@/lib/repositories/opening-balances';

export const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL?.replace(/\/$/, '') ?? '';
export const API_URL = 'Local SQLite';
export const api = {
  summary: getSummary, risk: getRisk, forecast: getForecast, categories: listCategories,
  accounts: listAccounts, activeAccounts: listActiveAccounts, managedAccounts: listManagedAccounts,
  createAccount, renameAccount, archiveAccount, restoreAccount, deleteUnusedAccount,
  historyState: getHistoryWorkflowState,
  recoverFinancialProfile,
  confirmFinancialHistoryStart,
  correctFinancialHistoryStart,
  transactions: async (_page = 1, pageSize = 100) => ({ items: await listTransactions(pageSize), total: (await listTransactions(5000)).length, page: 1, pageSize }),
  transaction: async (id: number) => { const tx = await getTransaction(id); if (!tx) throw new Error('Transaction not found.'); return tx; },
  createTransaction: (input: TransactionInput, options: TransactionCreationOptions) => createTransaction(input, options),
  updateTransaction: (id: number, input: TransactionInput, options?: TransactionMutationOptions) => updateTransaction(id, input, options),
  deleteTransaction,
  transfers: listTransfers,
  transfer: async (id: number) => { const transfer = await getTransfer(id); if (!transfer) throw new Error('Transfer not found.'); return transfer; },
  createTransfer: (input: TransferInput, clientId: string) => createTransfer(input, clientId),
  updateTransfer,
  deleteTransfer,
  openingBalanceState: getOpeningBalanceState,
  confirmOpeningBalance,
  correctOpeningBalance,
  activity: async () => {
    const [transactionRows, transferRows] = await Promise.all([listTransactions(5000), listTransfers()]);
    const items = [
      ...transactionRows.map((item) => ({ kind: 'transaction' as const, ...item })),
      ...transferRows.map((item) => ({ kind: 'transfer' as const, ...item })),
    ].sort((left, right) => right.date.localeCompare(left.date));
    return { items, total: items.length };
  },
  affordability: getAffordability,
  chat: async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    if (!AI_PROXY_URL) throw new Error('AI chat needs a secure backend URL. Local finance features remain available offline.');
    const response = await fetch(`${AI_PROXY_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? 'Chat is temporarily unavailable.');
    return body as { text: string };
  },
};
export { CategoryApplicabilityError, OverdraftConfirmationRequiredError };
export type { CategoryApplicabilityErrorCode, TransactionCreationOptions, TransactionMutationOptions };
export const createTransactionRequestId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export { formatPKR, formatTransactionPKR, transactionAmountTone } from '@/lib/finance/money-format';
