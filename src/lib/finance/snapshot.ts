import { prisma } from "@/lib/db"
import {
  categoryStats,
  endOfMonth,
  mean,
  monthlyTotals,
  monthsAgo,
  startOfMonth,
} from "@/lib/finance/helpers"
import type { FinancialSnapshot, Window } from "@/lib/types"
import { getAnalysisDate } from "@/lib/finance/clock"

export async function getSnapshot(userId: number, asOf = getAnalysisDate()): Promise<FinancialSnapshot> {
  const accounts = await prisma.account.findMany({ where: { userId } })

  const thisFrom = startOfMonth(asOf)
  const thisTo = endOfMonth(asOf)
  const last3From = startOfMonth(monthsAgo(asOf, 3))

  const monthly = await monthlyTotals(userId, last3From, thisTo)
  const last3 = monthly.slice(-3)
  const lastFullMonth = monthly.find((m) => m.month === ymKeyOf(asOf, -1))
  const thisMonth = monthly.find((m) => m.month === ymKeyOf(asOf, 0))

  const incomeAvg3 = Math.round(mean(last3.map((m) => m.income)))
  const spendAvg3 = Math.round(mean(last3.map((m) => m.expense)))
  const savingsAvg3 = Math.round(mean(last3.map((m) => m.savings)))
  const savingsRate = incomeAvg3 ? savingsAvg3 / incomeAvg3 : 0

  const top = await categoryStats(userId, thisFrom, thisTo)
  const top3 = top.slice(0, 3)

  // project remaining: assume same daily pace as so-far MTD
  const day = asOf.getDate()
  const dailyPace = thisMonth ? thisMonth.expense / Math.max(1, day) : 0
  const monthEndDay = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate()
  const projected = Math.round((thisMonth?.expense ?? 0) + dailyPace * (monthEndDay - day))

  return {
    asOf: asOf.toISOString(),
    balances: accounts.map((a) => ({ name: a.name, type: a.type, balance: a.balance })),
    totalBalance: accounts.reduce((s, a) => s + a.balance, 0),
    income: {
      thisMonth: thisMonth?.income ?? 0,
      lastMonth: lastFullMonth?.income ?? 0,
      threeMonthAvg: incomeAvg3,
    },
    spend: {
      thisMonthMTD: thisMonth?.expense ?? 0,
      thisMonthProjected: projected,
      lastMonth: lastFullMonth?.expense ?? 0,
      threeMonthAvg: spendAvg3,
    },
    savings: {
      thisMonth: thisMonth?.savings ?? 0,
      threeMonthAvg: savingsAvg3,
      rate: Math.round(savingsRate * 100) / 100,
    },
    topCategoriesMTD: top3,
    monthlyTotals: monthly,
  }
}

function ymKeyOf(d: Date, offset: number) {
  const t = new Date(d.getFullYear(), d.getMonth() + offset, 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`
}

export async function getCategoryBreakdownService(
  userId: number,
  window: Window,
  asOf = getAnalysisDate(),
  filterCategories?: string[],
) {
  let from: Date, to: Date
  if (window === "this_month") {
    from = startOfMonth(asOf)
    to = endOfMonth(asOf)
  } else if (window === "last_month") {
    from = startOfMonth(monthsAgo(asOf, 1))
    to = endOfMonth(monthsAgo(asOf, 1))
  } else {
    from = startOfMonth(monthsAgo(asOf, 3))
    to = endOfMonth(asOf)
  }
  let stats = await categoryStats(userId, from, to)
  if (filterCategories?.length) {
    const set = new Set(filterCategories.map((c) => c.toLowerCase()))
    stats = stats.filter((s) => set.has(s.category.toLowerCase()))
  }
  const total = stats.reduce((s, c) => s + c.total, 0)
  return { window, from: from.toISOString(), to: to.toISOString(), total, byCategory: stats }
}
