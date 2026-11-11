import { listAccounts } from '@/lib/repositories/catalog';
import { listAllTransactions } from '@/lib/repositories/transactions';
import { getFinancialHistoryState } from '@/lib/services/history-start-state';
import { getForecast } from '@/lib/services/finance';
import { createChatContextProvider } from './chat-context-core';

export const getChatContext = createChatContextProvider({
  listAccounts, listAllTransactions, getHistory: getFinancialHistoryState, getForecast, now: () => new Date(),
});
