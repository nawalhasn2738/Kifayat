import { reportingMonthKey, reportingMonthRange, reportingMonthStart } from '@/lib/finance/reporting-calendar';
import type { Affordability, Forecast, Risk, Summary, Transaction } from '@/lib/types';
import { validatePlanningHorizon } from '@/lib/validation/affordability';
import { MAX_PKR_AMOUNT } from '@/lib/validation/transaction';

type SummaryAccount = { name: string; type: string; balance: number };

export type SummaryDependencies = {
  listAccounts: () => Promise<SummaryAccount[]>;
  listAllTransactions: () => Promise<Transaction[]>;
  now: () => Date;
};

const unsafeMoneyError = 'Financial reporting requires JavaScript safe integer monetary values.';
const affordabilityMoneyError = 'Affordability requires safe whole-PKR monetary values.';

function checkedMoneyAdd(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error(unsafeMoneyError);
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(unsafeMoneyError);
  return result;
}

function checkedMoneySubtract(left: number, right: number) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new Error(unsafeMoneyError);
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new Error(unsafeMoneyError);
  return result;
}

function requireSafeAffordabilityMoney(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error(affordabilityMoneyError);
  return value;
}

function checkedAffordabilityAdd(left: number, right: number) {
  requireSafeAffordabilityMoney(left); requireSafeAffordabilityMoney(right);
  return requireSafeAffordabilityMoney(left + right);
}

function checkedAffordabilitySubtract(left: number, right: number) {
  requireSafeAffordabilityMoney(left); requireSafeAffordabilityMoney(right);
  return requireSafeAffordabilityMoney(left - right);
}

function checkedAffordabilityMultiply(left: number, right: number) {
  requireSafeAffordabilityMoney(left); requireSafeAffordabilityMoney(right);
  return requireSafeAffordabilityMoney(left * right);
}

function absoluteMoney(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error(unsafeMoneyError);
  const result = Math.abs(value);
  if (!Number.isSafeInteger(result)) throw new Error(unsafeMoneyError);
  return result;
}

export function meanMoney(values: number[]) {
  const total = values.reduce(checkedMoneyAdd, 0);
  return values.length ? total / values.length : 0;
}

export function sumAbsoluteMoney(transactions: Transaction[]) {
  return transactions.reduce((total, transaction) => checkedMoneyAdd(total, absoluteMoney(transaction.amount)), 0);
}
export function transactionsAtOrBefore(transactions: Transaction[], asOf: Date) {
  const cutoff = asOf.toISOString();
  return transactions.filter((transaction) => transaction.date <= cutoff);
}

export function monthly(transactions: Transaction[]) {
  const buckets = new Map<string, { month: string; income: number; expense: number; savings: number }>();
  for (const tx of transactions) {
    const month = reportingMonthKey(tx.date);
    const bucket = buckets.get(month) ?? { month, income: 0, expense: 0, savings: 0 };
    if (tx.type === 'income') bucket.income = checkedMoneyAdd(bucket.income, tx.amount);
    if (tx.type === 'expense') bucket.expense = checkedMoneyAdd(bucket.expense, absoluteMoney(tx.amount));
    bucket.savings = checkedMoneySubtract(bucket.income, bucket.expense);
    buckets.set(month, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function previousReportingMonthKey(month: string) {
  return reportingMonthKey(new Date(reportingMonthStart(month).getTime() - 1));
}

export function createSummaryService(dependencies: SummaryDependencies) {
  return async function getSummary(asOf = dependencies.now()): Promise<Summary> {
    const [accountRows, allTransactions] = await Promise.all([dependencies.listAccounts(), dependencies.listAllTransactions()]);
    const txs = transactionsAtOrBefore(allTransactions, asOf);
    const now = asOf;
    const totals = monthly(txs);
    const currentMonth = reportingMonthKey(now);
    const currentMonthRange = reportingMonthRange(currentMonth);
    const previousMonth = previousReportingMonthKey(currentMonth);
    const current = totals.find((item) => item.month === currentMonth);
    const previous = totals.find((item) => item.month === previousMonth);
    const recent = totals.filter((item) => item.month <= currentMonth).slice(-3);
    const categoryMap = new Map<string, { category: string; total: number; count: number }>();
    for (const tx of txs.filter((item) => item.type === 'expense' && reportingMonthKey(item.date) === currentMonth)) {
      const category = tx.category?.name ?? 'uncategorized';
      const row = categoryMap.get(category) ?? { category, total: 0, count: 0 };
      row.total = checkedMoneyAdd(row.total, absoluteMoney(tx.amount)); row.count += 1; categoryMap.set(category, row);
    }
    const elapsedDays = Math.floor((now.getTime() - currentMonthRange.start.getTime()) / 86_400_000) + 1;
    const daysInMonth = Math.round((currentMonthRange.endExclusive.getTime() - currentMonthRange.start.getTime()) / 86_400_000);
    const projected = Math.round((current?.expense ?? 0) / Math.max(1, elapsedDays) * daysInMonth);
    const incomeAvg = Math.round(meanMoney(recent.map((item) => item.income)));
    const spendingAvg = Math.round(meanMoney(recent.map((item) => item.expense)));
    const savingsAvg = Math.round(meanMoney(recent.map((item) => item.savings)));
    return {
      asOf: now.toISOString(), balances: accountRows.map(({ name, type, balance }) => ({ name, type, balance })),
      totalBalance: accountRows.reduce((sum, account) => checkedMoneyAdd(sum, account.balance), 0),
      income: { thisMonth: current?.income ?? 0, lastMonth: previous?.income ?? 0, threeMonthAvg: incomeAvg },
      spend: { thisMonthMTD: current?.expense ?? 0, thisMonthProjected: projected, lastMonth: previous?.expense ?? 0, threeMonthAvg: spendingAvg },
      savings: { thisMonth: current?.savings ?? 0, threeMonthAvg: savingsAvg, rate: incomeAvg ? savingsAvg / incomeAvg : 0 },
      topCategoriesMTD: [...categoryMap.values()].sort((a, b) => b.total - a.total).slice(0, 3), monthlyTotals: totals,
    };
  };
}

type AffordabilitySummary = {
  totalBalance: number;
  spend: { threeMonthAvg: number };
  savings: { threeMonthAvg: number };
};

export function calculateAffordability(
  input: { itemName: string; price: number; monthsAhead: number },
  summary: AffordabilitySummary,
  profile: { emergencyFundTarget: number },
): Affordability {
  if (!Number.isSafeInteger(input.price) || input.price <= 0 || input.price > MAX_PKR_AMOUNT) {
    throw new Error('Enter a valid positive whole amount within the supported range.');
  }
  validatePlanningHorizon(input.monthsAhead);
  requireSafeAffordabilityMoney(profile.emergencyFundTarget);
  if (profile.emergencyFundTarget < 0) throw new Error(affordabilityMoneyError);
  requireSafeAffordabilityMoney(summary.totalBalance);
  requireSafeAffordabilityMoney(summary.spend.threeMonthAvg);
  requireSafeAffordabilityMoney(summary.savings.threeMonthAvg);

  const threeMonthSpend = checkedAffordabilityMultiply(summary.spend.threeMonthAvg, 3);
  const buffer = Math.max(profile.emergencyFundTarget, threeMonthSpend);
  const monthlySavings = Math.max(0, summary.savings.threeMonthAvg);
  const projectedSavings = checkedAffordabilityMultiply(input.monthsAhead, monthlySavings);
  const projected = checkedAffordabilityAdd(summary.totalBalance, projectedSavings);
  const available = checkedAffordabilitySubtract(projected, buffer);
  const priceGap = checkedAffordabilitySubtract(input.price, available);
  const shortfall = Math.max(0, priceGap);

  return {
    canAfford: available >= input.price,
    available,
    buffer,
    shortfall,
    monthsNeededAtCurrentRate: monthlySavings ? Math.ceil(shortfall / monthlySavings) : -1,
    reason: available >= input.price
      ? 'The purchase preserves your emergency buffer.'
      : 'The purchase would reduce funds below your emergency buffer.',
  };
}
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stdev = (values: number[]) => {
  const average = meanMoney(values);
  return values.length < 2 ? 0 : Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

export function calculateForecast(
  transactions: Transaction[],
  asOf: Date,
  reportingMonths?: string[],
): Forecast {
  const monthlyTotals = monthly(transactionsAtOrBefore(transactions, asOf));
  const totals = reportingMonths
    ? reportingMonths.map((month) => monthlyTotals.find((item) => item.month === month)?.expense ?? 0)
    : monthlyTotals.slice(-3).map((item) => item.expense);
  const blend = Math.round(meanMoney(totals)); const variation = Math.round(stdev(totals));
  return { total: { blend, low: Math.max(0, blend - variation), high: blend + variation }, byCategory: {}, method: '3-month local mean ± standard deviation', asOf: asOf.toISOString() };
}

export function calculateRisk(
  summary: Summary,
  profile: { monthlyIncome: number },
  categories: { id: number; isHighRisk: boolean }[],
  transactions: Transaction[],
  asOf: Date,
): Risk {
  const txs = transactionsAtOrBefore(transactions, asOf);
  const recentMonths = summary.monthlyTotals.slice(-3).map((item) => item.expense);
  const recentStart = new Date(asOf); recentStart.setMonth(recentStart.getMonth() - 3);
  const recent = txs.filter((tx) => tx.type === 'expense' && new Date(tx.date) >= recentStart);
  const highRiskIds = new Set(categories.filter((item) => item.isHighRisk).map((item) => item.id));
  const total = sumAbsoluteMoney(recent);
  const risky = sumAbsoluteMoney(recent.filter((tx) => tx.category && highRiskIds.has(tx.category.id)));
  const anomalies = sumAbsoluteMoney(recent.filter((tx) => tx.isAnomaly));
  const spendRatio = Math.min(1, summary.spend.thisMonthMTD / Math.max(1, profile.monthlyIncome));
  const volatility = Math.min(1, stdev(recentMonths) / Math.max(1, meanMoney(recentMonths)));
  const savingsInverse = Math.min(1, 1 - Math.max(0, summary.savings.rate) / 0.2);
  const score = Math.round(100 * (0.35 * spendRatio + 0.2 * volatility + 0.2 * savingsInverse + 0.15 * (total ? risky / total : 0) + 0.1 * (total ? anomalies / total : 0)));
  const reasons = [] as string[];
  if (spendRatio > .85) reasons.push('Monthly spending is close to income.');
  if (volatility > .25) reasons.push('Spending has varied significantly recently.');
  if (savingsInverse > .5) reasons.push('Savings are below the 20% target.');
  if (!reasons.length) reasons.push('Current indicators are within healthy ranges.');
  return { score, band: score < 30 ? 'low' : score < 60 ? 'moderate' : 'high', reasons };
}
