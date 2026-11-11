import { reportingMonthKey, reportingMonthRange } from '../finance/reporting-calendar';
import type { Summary, ForecastResult, Risk } from '../types';
import type { FinancialHistoryState } from './history-start-state-core';
import type { SavingsPlanning } from './savings-planning-core';
import type { ActivityQuery } from '../validation/activity';
import type { ActivityPage } from './activity-core';
import { affordabilityFunds, completeMonthAverages } from './affordability-core';
import { calculateEmergencyBuffer } from './finance-core';
import { validateFinancialProfile, type FinancialProfileInput } from '../validation/profile';
export type DashboardSection<T> = { status: 'ready'; value: T } | { status: 'unavailable'; reason: string };
const unavailable = (reason: string): { status: 'unavailable'; reason: string } => ({ status: 'unavailable', reason });
async function section<T>(operation: () => Promise<T>, reason: string): Promise<DashboardSection<T>> {
  try { return { status: 'ready', value: await operation() }; } catch { return unavailable(reason); }
}
function precedingMonth(month: string) { return reportingMonthKey(new Date(reportingMonthRange(month).start.getTime() - 1)); }
export function dashboardTrend(summary: Summary, history: FinancialHistoryState | null, asOf: Date) {
  let month = reportingMonthKey(asOf);
  return Array.from({ length: 6 }, () => {
    month = precedingMonth(month);
    const complete = history?.status === 'confirmed' && history.value <= reportingMonthRange(month).start.toISOString();
    const totals = summary.monthlyTotals.find(row => row.month === month);
    return { month, complete, income: complete ? totals?.income ?? 0 : null, expense: complete ? totals?.expense ?? 0 : null };
  }).reverse();
}
export type DashboardDependencies = {
  getSummary: (asOf: Date) => Promise<Summary>;
  getHistory: () => Promise<FinancialHistoryState>;
  getProfile: () => Promise<FinancialProfileInput>;
  getForecast: (asOf: Date) => Promise<ForecastResult>;
  getRisk: (asOf: Date) => Promise<Risk>;
  getSavingsPlanning: (asOf: Date) => Promise<SavingsPlanning>;
  getActivity: (query: ActivityQuery) => Promise<ActivityPage>;
  listActiveAccounts: () => Promise<{ id: number; name: string; type: string; balance: number }[]>;
  now: () => Date;
};
export function createDashboardService(dependencies: DashboardDependencies) {
  return async function getDashboard() {
    const asOf = dependencies.now();
    const [summary, history, profile, forecast, savings, recent, accounts] = await Promise.all([
      section(() => dependencies.getSummary(asOf), 'Recorded financial totals could not be loaded.'),
      section(dependencies.getHistory, 'Financial-history coverage could not be verified.'),
      section(async () => validateFinancialProfile(await dependencies.getProfile()), 'Financial profile settings are missing or invalid.'),
      section(() => dependencies.getForecast(asOf), 'Forecast readiness could not be loaded.'),
      section(() => dependencies.getSavingsPlanning(asOf), 'Savings goals could not be loaded.'),
      section(() => dependencies.getActivity({ pageSize: 5, filters: { type: 'all', endExclusive: new Date(asOf.getTime() + 1).toISOString() } }), 'Recent activity could not be loaded.'),
      section(dependencies.listActiveAccounts, 'Active account balances could not be loaded.'),
    ]);
    const historyState = history.status === 'ready' ? history.value : null;
    const currentMonth = reportingMonthKey(asOf), currentStart = reportingMonthRange(currentMonth).start.toISOString();
    const currentCompleteFromStart = historyState?.status === 'confirmed' && historyState.value <= currentStart;
    const coverage = historyState?.status !== 'confirmed'
      ? 'History is missing, invalid or unconfirmed. These are recorded totals only; missing entries may change the picture. Confirm history in Planning.'
      : !currentCompleteFromStart ? 'History begins partway through or after this month. Month-to-date recorded totals are incomplete.'
      : 'History is confirmed from the start of this month. Month-to-date amounts cover the current partial Karachi month.';
    const hasAccounts = summary.status === 'ready' && summary.value.balances.length > 0;
    const riskStart = reportingMonthRange(precedingMonth(precedingMonth(currentMonth))).start.toISOString();
    const risk = hasAccounts && profile.status === 'ready' && historyState?.status === 'confirmed' && historyState.value <= riskStart
      ? await section(() => dependencies.getRisk(asOf), 'Risk could not be calculated from the current records.')
      : unavailable('Risk needs a valid profile, accounts, and confirmed coverage of the current month and two preceding calendar months.');
    let reserve: DashboardSection<{ buffer: number; eligibleBalance: number; difference: number; months: string[] }> = unavailable('Reserve position needs three complete preceding Karachi months, profile settings and an active checking or savings account.');
    if (summary.status === 'ready' && forecast.status === 'ready' && forecast.value.status === 'ready' && profile.status === 'ready' && accounts.status === 'ready') {
      try {
        const { eligibleAccounts, eligibleBalance } = affordabilityFunds(accounts.value);
        if (eligibleAccounts.length) {
          const { averageMonthlySpend } = completeMonthAverages(summary.value, forecast.value.qualifyingMonths);
          const buffer = calculateEmergencyBuffer(averageMonthlySpend, profile.value.emergencyFundTarget);
          const difference = eligibleBalance - buffer;
          if (!Number.isSafeInteger(difference)) throw new Error('Unsafe reserve comparison.');
          reserve = { status: 'ready', value: { buffer, eligibleBalance, difference, months: forecast.value.qualifyingMonths } };
        }
      } catch { reserve = unavailable('Reserve inputs could not be verified safely.'); }
    }
    const trend = summary.status === 'ready' ? dashboardTrend(summary.value, historyState, asOf) : [];
    return { asOf: asOf.toISOString(), currentMonth, summary, history, profile, forecast, savings, recent, risk, reserve, trend, coverage, hasAccounts,
      rate: summary.status === 'ready' && hasAccounts && summary.value.income.threeMonthAvg > 0 ? summary.value.savings.rate : null,
      projection: summary.status === 'ready' && hasAccounts && currentCompleteFromStart ? summary.value.spend.thisMonthProjected : null,
    };
  };
}
export type Dashboard = Awaited<ReturnType<ReturnType<typeof createDashboardService>>>;
