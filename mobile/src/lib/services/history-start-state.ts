import { db } from '@/lib/db/client';
import { createHistoryStartStateService } from '@/lib/services/history-start-state-core';

const historyStartStateService = createHistoryStartStateService(db);

export const { getFinancialHistoryState } = historyStartStateService;
