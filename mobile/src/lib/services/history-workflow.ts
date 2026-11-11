import { getForecast } from '@/lib/services/finance';
import { confirmHistoryStart, correctHistoryStart } from '@/lib/services/history-start-commands';
import { recoverMissingProfile } from '@/lib/services/history-start-recovery';
import { getFinancialHistoryState } from '@/lib/services/history-start-state';
import { createHistoryWorkflow } from '@/lib/services/history-workflow-core';

export const {
  getHistoryWorkflowState,
  recoverFinancialProfile,
  confirmFinancialHistoryStart,
  correctFinancialHistoryStart,
} = createHistoryWorkflow({
  getFinancialHistoryState,
  recoverMissingProfile,
  confirmHistoryStart,
  correctHistoryStart,
  getForecast,
});
