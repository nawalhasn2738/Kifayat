/**
 * Pure financial rule functions. The chatbot's NUMBERS come from here, never from the LLM.
 * See plan §8.
 */
import { prisma } from "@/lib/db"
import {
  EMERGENCY_FUND_MONTHS,
  HEALTHY_SAVINGS_RATE,
  HIGH_RISK_CATEGORIES,
  RISK_WEIGHTS,
  SAFE_INSTALLMENT_RATIO,
} from "@/lib/finance/constants"
import {
  categoryStats,
  endOfMonth,
  mean,
  monthlyTotals,
  monthsAgo,
  startOfMonth,
  stdev,
} from "@/lib/finance/helpers"
import type {
  AffordabilityResult,
  InstallmentResult,
  RiskScoreResult,
} from "@/lib/types"
import { getAnalysisDate } from "@/lib/finance/clock"

// Build the underlying financial context once per request, then reuse.
export async function buildContext(userId: number, asOf = getAnalysisDate()) {
  const profile = await prisma.userProfile.findUnique({ where: { userId } })
  if (!profile) throw new Error(`No profile for user ${userId}`)
  const accounts = await prisma.account.findMany({ where: { userId } })

  const thisMonthFrom = startOfMonth(asOf)
  const thisMonthTo = endOfMonth(asOf)
  const lastMonthFrom = startOfMonth(monthsAgo(asOf, 1))
  const lastMonthTo = endOfMonth(monthsAgo(asOf, 1))
  const last3From = startOfMonth(monthsAgo(asOf, 3))

  const monthly = await monthlyTotals(userId, last3From, thisMonthTo)
  const last3 = monthly.slice(-3)

  const totals = (window: { gte: Date; lte: Date }) =>
    prisma.transaction.aggregate({
      where: { userId, date: window, type: "expense" },
      _sum: { amount: true },
    })

  const income = (window: { gte: Date; lte: Date }) =>
    prisma.transaction.aggregate({
      where: { userId, date: window, type: "income" },
      _sum: { amount: true },
    })

  const [thisMonthSpend, lastMonthSpend, thisMonthIncome] = await Promise.all([
    totals({ gte: thisMonthFrom, lte: thisMonthTo }),
    totals({ gte: lastMonthFrom, lte: lastMonthTo }),
    income({ gte: thisMonthFrom, lte: thisMonthTo }),
  ])

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)
  const checkingBalance = accounts.find((a) => a.type === "checking")?.balance ?? 0
  const savingsBalance = accounts.find((a) => a.type === "savings")?.balance ?? 0

  const monthlyExpenseAvg = Math.round(
    mean(last3.map((m) => m.expense)) || profile.monthlyIncome * 0.7,
  )

  const avgSavings = Math.round(mean(last3.map((m) => m.savings)) || 0)

  const stats3 = await categoryStats(userId, last3From, thisMonthTo)
  const totalSpend3 = stats3.reduce((s, c) => s + c.total, 0)
  const highRiskSpend3 = stats3
    .filter((c) => HIGH_RISK_CATEGORIES.has(c.category))
    .reduce((s, c) => s + c.total, 0)

  const anomalySpend3 = await prisma.transaction
    .aggregate({
      where: {
        userId,
        type: "expense",
        date: { gte: last3From, lte: thisMonthTo },
        isAnomaly: true,
      },
      _sum: { amount: true },
    })
    .then((a) => Math.abs(a._sum.amount ?? 0))

  return {
    profile,
    accounts,
    asOf,
    income: profile.monthlyIncome,
    monthlyExpenseAvg,
    monthSpend: Math.abs(thisMonthSpend._sum.amount ?? 0),
    monthIncome: thisMonthIncome._sum.amount ?? 0,
    lastMonthSpend: Math.abs(lastMonthSpend._sum.amount ?? 0),
    last3MonthsSpend: last3.map((m) => m.expense),
    last3MonthsSavings: last3.map((m) => m.savings),
    avgMonthlySavings: avgSavings,
    totalBalance,
    checkingBalance,
    savingsBalance,
    totalSpend3,
    highRiskSpend3,
    anomalySpend3,
    stats3,
  }
}

export type FinancialContext = Awaited<ReturnType<typeof buildContext>>

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export function riskScore(ctx: FinancialContext): RiskScoreResult {
  const r1 = clamp01(ctx.monthSpend / Math.max(1, ctx.income))
  const meanSpend = mean(ctx.last3MonthsSpend) || 1
  const volatility = stdev(ctx.last3MonthsSpend) / meanSpend
  const r2 = clamp01(volatility)
  const savingsRate = ctx.avgMonthlySavings / Math.max(1, ctx.income)
  const r3 = clamp01(1 - savingsRate / HEALTHY_SAVINGS_RATE)
  const r4 = clamp01(ctx.totalSpend3 ? ctx.highRiskSpend3 / ctx.totalSpend3 : 0)
  const r5 = clamp01(ctx.totalSpend3 ? ctx.anomalySpend3 / ctx.totalSpend3 : 0)

  const score = Math.round(
    100 *
      (RISK_WEIGHTS.spendToIncome * r1 +
        RISK_WEIGHTS.volatility * r2 +
        RISK_WEIGHTS.savingsRateInverse * r3 +
        RISK_WEIGHTS.highRiskShare * r4 +
        RISK_WEIGHTS.anomalyShare * r5),
  )
  const band: RiskScoreResult["band"] = score < 30 ? "low" : score < 60 ? "moderate" : "high"

  const reasons: string[] = []
  if (r1 > 0.85) reasons.push(`Spending ${Math.round(r1 * 100)}% of monthly income`)
  if (r2 > 0.25) reasons.push(`Monthly spend volatile (CV ${(volatility * 100).toFixed(0)}%)`)
  if (r3 > 0.5) reasons.push(`Savings rate (${(savingsRate * 100).toFixed(1)}%) below 20% target`)
  if (r4 > 0.25) reasons.push(`High-risk categories are ${(r4 * 100).toFixed(0)}% of spend`)
  if (r5 > 0.05) reasons.push(`Anomalous transactions are ${(r5 * 100).toFixed(0)}% of spend`)
  if (reasons.length === 0) reasons.push("All risk components within healthy bounds")

  return {
    score,
    band,
    breakdown: {
      spendToIncome: Math.round(r1 * 100) / 100,
      volatility: Math.round(r2 * 100) / 100,
      savingsRateInverse: Math.round(r3 * 100) / 100,
      highRiskShare: Math.round(r4 * 100) / 100,
      anomalyShare: Math.round(r5 * 100) / 100,
    },
    reasons,
  }
}

export function affordability(
  ctx: FinancialContext,
  args: { itemName: string; price: number; monthsAhead: number },
): AffordabilityResult {
  const { price, monthsAhead, itemName } = args
  const buffer = ctx.monthlyExpenseAvg * EMERGENCY_FUND_MONTHS
  const liquidNow = ctx.savingsBalance + ctx.checkingBalance
  const projectedSavings = ctx.savingsBalance + monthsAhead * Math.max(0, ctx.avgMonthlySavings)
  const projected =
    projectedSavings + ctx.checkingBalance + monthsAhead * Math.max(0, ctx.avgMonthlySavings * 0)
  const available = monthsAhead === 0 ? liquidNow - buffer : projected - buffer
  const canAfford = available >= price
  const monthsNeeded =
    ctx.avgMonthlySavings > 0
      ? Math.max(
          0,
          Math.ceil((price + buffer - ctx.savingsBalance - ctx.checkingBalance) /
            ctx.avgMonthlySavings),
        )
      : Number.POSITIVE_INFINITY

  let reason: string
  if (canAfford) {
    reason =
      monthsAhead === 0
        ? `Liquid ${liquidNow} − buffer ${buffer} = ${available} available, covers price ${price}`
        : `In ${monthsAhead} mo, projected liquid ${projected} − buffer ${buffer} = ${available} available, covers price ${price}`
  } else {
    reason = `Available ${available} after ${monthsAhead}-month buffer < price ${price}; estimated ${
      monthsNeeded === Number.POSITIVE_INFINITY ? "(stuck — savings rate is 0)" : monthsNeeded
    } months at current savings rate`
  }

  return {
    itemName,
    price,
    monthsAhead,
    available: Math.round(available),
    buffer,
    shortfall: Math.max(0, price - Math.round(available)),
    canAfford,
    monthsNeededAtCurrentRate:
      monthsNeeded === Number.POSITIVE_INFINITY ? -1 : monthsNeeded,
    reason,
  }
}

function emi(price: number, apr: number, months: number) {
  if (apr === 0) return Math.ceil(price / months)
  const r = apr / 12
  return Math.ceil((price * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1))
}

export function installmentSafety(
  ctx: FinancialContext,
  args: { price: number; months: number; apr: number },
): InstallmentResult {
  const monthly = emi(args.price, args.apr, args.months)
  const essentialAvg =
    ctx.stats3
      .filter((s) => s.isEssential)
      .reduce((sum, s) => sum + s.total, 0) / 3
  const disposable = Math.max(1, ctx.income - Math.round(essentialAvg))
  const ratio = monthly / disposable
  const safe = ratio <= SAFE_INSTALLMENT_RATIO
  const reason = safe
    ? `EMI ${monthly} is ${(ratio * 100).toFixed(0)}% of disposable ${disposable}, within ${SAFE_INSTALLMENT_RATIO * 100}% safe ratio`
    : `EMI ${monthly} is ${(ratio * 100).toFixed(0)}% of disposable ${disposable}, EXCEEDS ${SAFE_INSTALLMENT_RATIO * 100}% safe ratio`
  return {
    price: args.price,
    months: args.months,
    apr: args.apr,
    monthly,
    ratio: Math.round(ratio * 100) / 100,
    safe,
    reason,
  }
}

export function monthlyHealth(ctx: FinancialContext) {
  const remainingDays = Math.max(
    1,
    new Date(ctx.asOf.getFullYear(), ctx.asOf.getMonth() + 1, 0).getDate() -
      ctx.asOf.getDate(),
  )
  const daysSoFar = ctx.asOf.getDate()
  const dailyPace = ctx.monthSpend / Math.max(1, daysSoFar)
  const projected = Math.round(ctx.monthSpend + dailyPace * remainingDays)
  const baseline = Math.round(mean(ctx.last3MonthsSpend) || ctx.monthlyExpenseAvg)
  const ratio = projected / Math.max(1, baseline)
  const status: "on_track" | "watch" | "over" =
    ratio < 0.95 ? "on_track" : ratio < 1.1 ? "watch" : "over"
  return {
    monthSpendMTD: ctx.monthSpend,
    projectedMonthSpend: projected,
    baselineMonthSpend: baseline,
    daysElapsed: daysSoFar,
    daysRemaining: remainingDays,
    status,
    reason:
      status === "on_track"
        ? `Projected ${projected} ≈ ${(ratio * 100).toFixed(0)}% of 3-month baseline ${baseline}`
        : status === "watch"
        ? `Projected ${projected} is ${(ratio * 100).toFixed(0)}% of baseline ${baseline} — slightly above`
        : `Projected ${projected} is ${(ratio * 100).toFixed(0)}% of baseline ${baseline} — clearly over`,
  }
}

export function savingsRecommendation(ctx: FinancialContext) {
  const target = Math.round(ctx.income * HEALTHY_SAVINGS_RATE)
  const expectedExpenses = Math.round(mean(ctx.last3MonthsSpend) || ctx.monthlyExpenseAvg)
  const dynamicCap = Math.max(0, ctx.income - expectedExpenses)
  const recommended = Math.min(target, dynamicCap > 0 ? dynamicCap : target)
  return {
    targetByRule: target,
    expectedExpenses,
    headroom: dynamicCap,
    recommendedMonthlyTransfer: recommended,
    reason:
      dynamicCap < target
        ? `Income ${ctx.income} − expenses ${expectedExpenses} = headroom ${dynamicCap} which is below 20% target ${target}; suggesting headroom-aligned saving`
        : `20% of income (${target}) is achievable given headroom ${dynamicCap}; standard 50/30/20 rule applies`,
  }
}

export async function goalProgress(userId: number, ctx: FinancialContext, name?: string) {
  const goals = await prisma.savingsGoal.findMany({
    where: { userId, ...(name ? { name } : {}) },
  })
  return goals.map((g) => {
    const remaining = Math.max(0, g.targetAmount - g.currentAmount)
    const monthsToGoal =
      ctx.avgMonthlySavings > 0 ? Math.ceil(remaining / ctx.avgMonthlySavings) : -1
    const onTrack =
      monthsToGoal > 0 &&
      g.targetDate.getTime() - ctx.asOf.getTime() >= monthsToGoal * 30 * 24 * 3600 * 1000
    return {
      id: g.id,
      name: g.name,
      target: g.targetAmount,
      current: g.currentAmount,
      remaining,
      targetDate: g.targetDate.toISOString(),
      monthsToGoalAtCurrentRate: monthsToGoal,
      onTrack,
      reason:
        monthsToGoal === -1
          ? "Savings rate is 0, cannot project progress"
          : onTrack
          ? `Need ${monthsToGoal} months at current ${ctx.avgMonthlySavings}/mo savings; deadline allows it`
          : `Need ${monthsToGoal} months at current ${ctx.avgMonthlySavings}/mo savings; deadline ${g.targetDate.toDateString()} too tight`,
    }
  })
}
