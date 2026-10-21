import type { ForecastResult } from '@/lib/types';
import type {
  ConfirmHistoryStartInput,
  ConfirmHistoryStartResult,
  CorrectHistoryStartInput,
  CorrectHistoryStartResult,
} from '@/lib/services/history-start-commands-core';
import type {
  MissingProfileRecoveryInput,
  MissingProfileRecoveryResult,
} from '@/lib/services/history-start-recovery-core';
import type { FinancialHistoryState } from '@/lib/services/history-start-state-core';

export type HistoryWorkflowReadResult =
  | {
    status: 'loaded';
    history: FinancialHistoryState;
    forecast: ForecastResult;
  }
  | { status: 'failed'; reason: 'service_unavailable' };

export type HistoryWorkflowActionResult<TResult> =
  | { status: 'handled'; outcome: TResult; refreshed: HistoryWorkflowReadResult | null }
  | { status: 'failed'; reason: 'service_unavailable' };

export type HistoryWorkflowDependencies = {
  getFinancialHistoryState: () => Promise<FinancialHistoryState>;
  recoverMissingProfile: (input: MissingProfileRecoveryInput) => Promise<MissingProfileRecoveryResult>;
  confirmHistoryStart: (input: ConfirmHistoryStartInput) => Promise<ConfirmHistoryStartResult>;
  correctHistoryStart: (input: CorrectHistoryStartInput) => Promise<CorrectHistoryStartResult>;
  getForecast: () => Promise<ForecastResult>;
};

export function createHistoryWorkflow(dependencies: HistoryWorkflowDependencies) {
  async function getHistoryWorkflowState(): Promise<HistoryWorkflowReadResult> {
    try {
      const [history, forecast] = await Promise.all([
        dependencies.getFinancialHistoryState(),
        dependencies.getForecast(),
      ]);
      return { status: 'loaded', history, forecast };
    } catch {
      return { status: 'failed', reason: 'service_unavailable' };
    }
  }

  async function runAction<TResult>(
    operation: () => Promise<TResult>,
    succeeded: (result: TResult) => boolean,
  ): Promise<HistoryWorkflowActionResult<TResult>> {
    try {
      const outcome = await operation();
      return {
        status: 'handled',
        outcome,
        refreshed: succeeded(outcome) ? await getHistoryWorkflowState() : null,
      };
    } catch {
      return { status: 'failed', reason: 'service_unavailable' };
    }
  }

  const recoverFinancialProfile = (input: MissingProfileRecoveryInput) => runAction(
    () => dependencies.recoverMissingProfile(input),
    (result) => result.status === 'recovered',
  );

  const confirmFinancialHistoryStart = (input: ConfirmHistoryStartInput) => runAction(
    () => dependencies.confirmHistoryStart(input),
    (result) => result.status === 'confirmed',
  );

  const correctFinancialHistoryStart = (input: CorrectHistoryStartInput) => runAction(
    () => dependencies.correctHistoryStart(input),
    (result) => result.status === 'corrected',
  );

  return {
    getHistoryWorkflowState,
    recoverFinancialProfile,
    confirmFinancialHistoryStart,
    correctFinancialHistoryStart,
  };
}
