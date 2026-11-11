import { calculateAffordability, meanMoney } from '@/lib/services/finance-core';
import type { AffordabilityAssessment, ForecastResult, Summary } from '@/lib/types';

export type AffordabilityServiceDependencies = {
  getSummary: () => Promise<Summary>;
  getProfile: () => Promise<{ emergencyFundTarget: number }>;
  getForecast: () => Promise<ForecastResult>;
  listActiveAccounts: () => Promise<{ id: number; name: string; type: string; balance: number }[]>;
};

export function createAffordabilityService(dependencies: AffordabilityServiceDependencies) {
  return async function getAffordability(
    input: { itemName: string; price: number; monthsAhead: number },
  ): Promise<AffordabilityAssessment> {
    const forecast = await dependencies.getForecast();
    if (forecast.status !== 'ready') {
      return {
        status: 'insufficient_history',
        result: null,
        guidance: forecast.guidance,
        availableCompleteMonths: forecast.availableCompleteMonths,
        requiredCompleteMonths: forecast.requiredCompleteMonths,
      };
    }
    const [summary, profile, accountRows] = await Promise.all([
      dependencies.getSummary(), dependencies.getProfile(), dependencies.listActiveAccounts(),
    ]);
    const eligibleAccounts = accountRows.filter(
      (account): account is typeof account & { type: 'checking' | 'savings' } =>
        account.type === 'checking' || account.type === 'savings',
    );
    if (!eligibleAccounts.length) {
      return {
        status: 'insufficient_information',
        result: null,
        guidance: 'Add or restore an active checking or savings account before assessing a purchase.',
      };
    }
    const eligibleBalance = eligibleAccounts.reduce((total, account) => {
      const next = total + account.balance;
      if (!Number.isSafeInteger(account.balance) || !Number.isSafeInteger(next)) {
        throw new Error('Affordability requires safe whole-PKR monetary values.');
      }
      return next;
    }, 0);
    const completeMonths = forecast.qualifyingMonths.map(
      (month) => summary.monthlyTotals.find((row) => row.month === month)
        ?? { month, income: 0, expense: 0, savings: 0 },
    );
    const averageMonthlySpend = Math.round(meanMoney(completeMonths.map((row) => row.expense)));
    const averageMonthlySavings = Math.round(meanMoney(completeMonths.map((row) => row.savings)));
    return {
      status: 'ready',
      result: calculateAffordability(input, {
        totalBalance: eligibleBalance,
        spend: { threeMonthAvg: averageMonthlySpend },
        savings: { threeMonthAvg: averageMonthlySavings },
      }, profile),
      accounts: eligibleAccounts.map(({ id, name, type, balance }) => ({ id, name, type, balance })),
      eligibleBalance,
      averageMonthlySpend,
      averageMonthlySavings,
      qualifyingMonths: forecast.qualifyingMonths,
    };
  };
}
