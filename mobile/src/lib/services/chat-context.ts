import { getProfile, listActiveAccounts, listAccounts } from '@/lib/repositories/catalog';
import { listAllTransactions } from '@/lib/repositories/transactions';
import { getFinancialHistoryState } from '@/lib/services/history-start-state';
import { createAffordabilityService } from './affordability-core';
import { getForecast } from '@/lib/services/finance';
import { createChatContextProvider } from './chat-context-core';

export const getChatContext = createChatContextProvider({
  getAffordability: (input, _asOf, snapshot) => createAffordabilityService({
    getSummary: async () => snapshot.summary,
    getProfile, listActiveAccounts, getForecast: async () => snapshot.forecast,
  })(input),
  listAccounts, listAllTransactions, getHistory: getFinancialHistoryState, getForecast, now: () => new Date(),
});
