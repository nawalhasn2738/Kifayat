import { getDashboard } from '@/lib/services/dashboard';
import { getActivity } from '@/lib/services/activity';
import { getSavingsPlanning } from '@/lib/services/savings-planning';
import { createGoal, updateGoalTarget } from '@/lib/repositories/savings-goals';
import { getProfileSettings, saveProfileSettings, listAccounts, listActiveAccounts, listCategories } from '@/lib/repositories/catalog';
import { archiveAccount, createAccount, deleteUnusedAccount, listManagedAccounts, renameAccount, restoreAccount } from '@/lib/repositories/accounts';
import { CategoryApplicabilityError, OverdraftConfirmationRequiredError, type CategoryApplicabilityErrorCode, type TransactionCreationOptions, type TransactionMutationOptions } from '@/lib/repositories/transactions-core';
import { createTransaction, deleteTransaction, getTransaction, updateTransaction } from '@/lib/repositories/transactions';
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
import { createChatClient } from '@/lib/services/chat-client-core';
import { getChatContext } from '@/lib/services/chat-context';

export const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL?.replace(/\/$/, '') ?? '';
export const API_URL = 'Local SQLite';
export const api = {
  dashboard: getDashboard,
  savingsPlanning: getSavingsPlanning, createGoal, updateGoalTarget,
  profileSettings: getProfileSettings, saveProfileSettings,
  summary: getSummary, risk: getRisk, forecast: getForecast, categories: listCategories,
  accounts: listAccounts, activeAccounts: listActiveAccounts, managedAccounts: listManagedAccounts,
  createAccount, renameAccount, archiveAccount, restoreAccount, deleteUnusedAccount,
  historyState: getHistoryWorkflowState,
  recoverFinancialProfile,
  confirmFinancialHistoryStart,
  correctFinancialHistoryStart,
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
  activity: getActivity,
  affordability: getAffordability,
  chat: createChatClient({ endpoint: AI_PROXY_URL, getContext: getChatContext, fetch: (...args) => fetch(...args) }),
};
export { CategoryApplicabilityError, OverdraftConfirmationRequiredError };
export type { CategoryApplicabilityErrorCode, TransactionCreationOptions, TransactionMutationOptions };
export const createTransactionRequestId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export { formatPKR, formatTransactionPKR, transactionAmountTone } from '@/lib/finance/money-format';
