import { getProfile, listAccounts, listCategories } from '@/lib/repositories/catalog';
import { listTransactions } from '@/lib/repositories/transactions';
import type { Affordability, Forecast, Risk, Summary, Transaction } from '@/lib/types';

const key = (iso: string) => iso.slice(0, 7);
const mean = (xs: number[]) => xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : 0;
const stdev = (xs: number[]) => {
  const average = mean(xs);
  return xs.length < 2 ? 0 : Math.sqrt(mean(xs.map((value) => (value - average) ** 2)));
};
function monthKey(date: Date, offset = 0) {
  const value = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}
function monthly(transactions: Transaction[]) {
  const buckets = new Map<string, { month: string; income: number; expense: number; savings: number }>();
  for (const tx of transactions) {
    const month = key(tx.date);
    const bucket = buckets.get(month) ?? { month, income: 0, expense: 0, savings: 0 };
    if (tx.type === 'income') bucket.income += tx.amount;
    if (tx.type === 'expense') bucket.expense += Math.abs(tx.amount);
    if (tx.type === 'transfer' && tx.amount < 0) bucket.savings += Math.abs(tx.amount);
    buckets.set(month, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export async function getSummary(): Promise<Summary> {
  const [accountRows, txs] = await Promise.all([listAccounts(), listTransactions(5000)]);
  const now = new Date();
  const totals = monthly(txs);
  const current = totals.find((item) => item.month === monthKey(now));
  const previous = totals.find((item) => item.month === monthKey(now, -1));
  const recent = totals.filter((item) => item.month <= monthKey(now)).slice(-3);
  const categoryMap = new Map<string, { category: string; total: number; count: number }>();
  for (const tx of txs.filter((item) => item.type === 'expense' && key(item.date) === monthKey(now))) {
    const category = tx.category?.name ?? 'uncategorized';
    const row = categoryMap.get(category) ?? { category, total: 0, count: 0 };
    row.total += Math.abs(tx.amount); row.count += 1; categoryMap.set(category, row);
  }
  const projected = Math.round((current?.expense ?? 0) / Math.max(1, now.getDate()) * new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  const incomeAvg = Math.round(mean(recent.map((item) => item.income)));
  const spendingAvg = Math.round(mean(recent.map((item) => item.expense)));
  const savingsAvg = Math.round(mean(recent.map((item) => item.savings)));
  return {
    asOf: now.toISOString(), balances: accountRows.map(({ name, type, balance }) => ({ name, type, balance })),
    totalBalance: accountRows.reduce((sum, account) => sum + account.balance, 0),
    income: { thisMonth: current?.income ?? 0, lastMonth: previous?.income ?? 0, threeMonthAvg: incomeAvg },
    spend: { thisMonthMTD: current?.expense ?? 0, thisMonthProjected: projected, lastMonth: previous?.expense ?? 0, threeMonthAvg: spendingAvg },
    savings: { thisMonth: current?.savings ?? 0, threeMonthAvg: savingsAvg, rate: incomeAvg ? savingsAvg / incomeAvg : 0 },
    topCategoriesMTD: [...categoryMap.values()].sort((a, b) => b.total - a.total).slice(0, 3), monthlyTotals: totals,
  };
}

export async function getForecast(): Promise<Forecast> {
  const totals = monthly(await listTransactions(5000)).slice(-3).map((item) => item.expense);
  const blend = Math.round(mean(totals)); const variation = Math.round(stdev(totals));
  return { total: { blend, low: Math.max(0, blend - variation), high: blend + variation }, byCategory: {}, method: '3-month local mean ± standard deviation', asOf: new Date().toISOString() };
}

export async function getRisk(): Promise<Risk> {
  const [summary, profile, categories, txs] = await Promise.all([getSummary(), getProfile(), listCategories(), listTransactions(5000)]);
  const recentMonths = summary.monthlyTotals.slice(-3).map((item) => item.expense);
  const recentStart = new Date(); recentStart.setMonth(recentStart.getMonth() - 3);
  const recent = txs.filter((tx) => tx.type === 'expense' && new Date(tx.date) >= recentStart);
  const highRiskIds = new Set(categories.filter((item) => item.isHighRisk).map((item) => item.id));
  const total = recent.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const risky = recent.filter((tx) => tx.category && highRiskIds.has(tx.category.id)).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const anomalies = recent.filter((tx) => tx.isAnomaly).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const spendRatio = Math.min(1, summary.spend.thisMonthMTD / Math.max(1, profile.monthlyIncome));
  const volatility = Math.min(1, stdev(recentMonths) / Math.max(1, mean(recentMonths)));
  const savingsInverse = Math.min(1, 1 - Math.max(0, summary.savings.rate) / 0.2);
  const score = Math.round(100 * (0.35 * spendRatio + 0.2 * volatility + 0.2 * savingsInverse + 0.15 * (total ? risky / total : 0) + 0.1 * (total ? anomalies / total : 0)));
  const reasons = [] as string[];
  if (spendRatio > .85) reasons.push('Monthly spending is close to income.');
  if (volatility > .25) reasons.push('Spending has varied significantly recently.');
  if (savingsInverse > .5) reasons.push('Savings are below the 20% target.');
  if (!reasons.length) reasons.push('Current indicators are within healthy ranges.');
  return { score, band: score < 30 ? 'low' : score < 60 ? 'moderate' : 'high', reasons };
}

export async function getAffordability(input: { itemName: string; price: number; monthsAhead: number }): Promise<Affordability> {
  if (!Number.isInteger(input.price) || input.price <= 0) throw new Error('Enter a valid positive whole amount.');
  const [summary, profile] = await Promise.all([getSummary(), getProfile()]);
  const buffer = Math.max(profile.emergencyFundTarget, summary.spend.threeMonthAvg * 3);
  const projected = summary.totalBalance + input.monthsAhead * Math.max(0, summary.savings.threeMonthAvg);
  const available = projected - buffer; const shortfall = Math.max(0, input.price - available);
  const monthly = Math.max(0, summary.savings.threeMonthAvg);
  return { canAfford: available >= input.price, available: Math.round(available), buffer, shortfall: Math.round(shortfall),
    monthsNeededAtCurrentRate: monthly ? Math.ceil(shortfall / monthly) : -1,
    reason: available >= input.price ? 'The purchase preserves your emergency buffer.' : 'The purchase would reduce funds below your emergency buffer.' };
}
