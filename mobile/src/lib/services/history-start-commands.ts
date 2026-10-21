import { db } from '@/lib/db/client';
import { createHistoryStartCommandService } from '@/lib/services/history-start-commands-core';

const historyStartCommandService = createHistoryStartCommandService(db);

export const { confirmHistoryStart, correctHistoryStart } = historyStartCommandService;
