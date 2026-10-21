import type { ForecastResult } from '@/lib/types';
import type { HistoryWorkflowActionResult, HistoryWorkflowReadResult } from '@/lib/services/history-workflow-core';

export function parseRecoveryPkr(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 2_147_483_647 ? value : null;
}

export function historyActionError(reason: string): string {
  const messages: Record<string, string> = {
    invalid_calendar_date: 'Enter a valid Karachi calendar date in YYYY-MM-DD format.',
    future_date: 'The history start cannot be in the future.',
    invalid_expected_value: 'The saved history start could not be verified. Refresh and try again.',
    missing_profile: 'Your local financial profile is missing. Recover it before continuing.',
    invalid_history_start: 'The saved history start is invalid. Financial data was not changed.',
    already_confirmed: 'A history start is already confirmed. Use correction instead.',
    unconfirmed: 'Confirm a history start before trying to correct it.',
    stale_value: 'The history start changed since this screen loaded. Refresh and review it again.',
    no_change: 'Choose a different date before saving a correction.',
    invalid_input: 'Enter whole PKR amounts from 0 to 2,147,483,647.',
    user_not_found: 'The local user record is unavailable, so recovery cannot continue.',
    profile_exists: 'A profile already exists. Refresh to view its current state.',
    write_failed: 'The change could not be saved. No partial change was kept.',
    service_unavailable: 'Financial history is temporarily unavailable. Please try again.',
  };
  return messages[reason] ?? 'The request was rejected. Refresh and try again.';
}

export function forecastReadinessText(result: ForecastResult): string {
  if (result.status === 'ready') return result.guidance;
  if (result.reason === 'insufficient_complete_months') {
    return `${result.availableCompleteMonths} of ${result.requiredCompleteMonths} complete consecutive Karachi months are available. The current partial month does not count.`;
  }
  return result.guidance;
}

export function createExclusiveSubmissionGuard() {
  let inProgress = false;
  return async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    if (inProgress) return null;
    inProgress = true;
    try {
      return await operation();
    } finally {
      inProgress = false;
    }
  };
}
export type LatestRequestCallbacks<T> = {
  loading: (value: boolean) => void;
  loaded: (value: T) => void;
  failed: (message: string) => void;
};

export function createLatestRequestCoordinator<T>(callbacks: LatestRequestCallbacks<T>) {
  let generation = 0;

  async function load(loader: () => Promise<T>) {
    const request = ++generation;
    callbacks.loading(true);
    try {
      const value = await loader();
      if (request !== generation) return { status: 'stale' } as const;
      callbacks.loaded(value);
      return { status: 'loaded', value } as const;
    } catch (caught) {
      if (request !== generation) return { status: 'stale' } as const;
      const message = caught instanceof Error ? caught.message : 'Unable to load data';
      callbacks.failed(message);
      return { status: 'failed', message } as const;
    } finally {
      if (request === generation) callbacks.loading(false);
    }
  }

  function invalidate() {
    generation += 1;
    callbacks.loading(false);
  }

  function publish(value: T) {
    generation += 1;
    callbacks.loaded(value);
    callbacks.loading(false);
  }

  return { load, invalidate, publish };
}

type HistoryOutcome = { status: string; reason?: string };

export type HistorySubmissionCallbacks = {
  saving: (value: boolean) => void;
  clearMessages: () => void;
  rejected: (message: string) => void;
  saved: (message: string) => void;
  savedButRefreshFailed: () => void;
  publish: (value: HistoryWorkflowReadResult) => void;
  invalidateReads: () => void;
};

export function createHistorySubmissionRunner(callbacks: HistorySubmissionCallbacks) {
  const guard = createExclusiveSubmissionGuard();
  let active = false;

  async function submit<TResult extends HistoryOutcome>(
    operation: () => Promise<HistoryWorkflowActionResult<TResult>>,
    successMessage: string,
  ) {
    return guard(async () => {
      active = true;
      callbacks.saving(true);
      callbacks.clearMessages();
      callbacks.invalidateReads();
      try {
        const response = await operation();
        if (response.status === 'failed') {
          callbacks.rejected(historyActionError(response.reason));
          return response;
        }
        if (response.outcome.status === 'rejected') {
          callbacks.rejected(historyActionError(response.outcome.reason ?? 'service_unavailable'));
          return response;
        }
        if (response.refreshed?.status === 'loaded') {
          callbacks.publish(response.refreshed);
          callbacks.saved(successMessage);
        } else {
          callbacks.savedButRefreshFailed();
        }
        return response;
      } catch {
        callbacks.rejected(historyActionError('service_unavailable'));
        return null;
      } finally {
        callbacks.saving(false);
        active = false;
      }
    });
  }

  return { submit, isActive: () => active };
}