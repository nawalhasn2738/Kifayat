import assert from "node:assert/strict"
import test from "node:test"
import { affordability, installmentSafety, monthlyHealth, riskScore } from "../src/lib/finance/rules"
import type { FinancialContext } from "../src/lib/finance/rules"

function context(overrides: Partial<FinancialContext> = {}): FinancialContext {
  return {
    profile: {} as FinancialContext["profile"],
    accounts: [],
    asOf: new Date("2026-05-10T12:00:00"),
    income: 120_000,
    monthlyExpenseAvg: 80_000,
    monthSpend: 20_000,
    monthIncome: 120_000,
    lastMonthSpend: 80_000,
    last3MonthsSpend: [75_000, 80_000, 85_000],
    last3MonthsSavings: [20_000, 20_000, 20_000],
    avgMonthlySavings: 20_000,
    totalBalance: 300_000,
    checkingBalance: 160_000,
    savingsBalance: 140_000,
    totalSpend3: 240_000,
    highRiskSpend3: 24_000,
    anomalySpend3: 0,
    stats3: [],
    ...overrides,
  }
}

test("affordability preserves the emergency buffer", () => {
  const result = affordability(context(), { itemName: "Laptop", price: 80_000, monthsAhead: 0 })
  assert.equal(result.buffer, 240_000)
  assert.equal(result.available, 60_000)
  assert.equal(result.canAfford, false)
  assert.equal(result.shortfall, 20_000)
})

test("zero-interest installments are evaluated against disposable income", () => {
  const result = installmentSafety(context(), { price: 120_000, months: 12, apr: 0 })
  assert.equal(result.monthly, 10_000)
  assert.equal(result.safe, true)
})

test("monthly health projects from elapsed days", () => {
  const result = monthlyHealth(context({ monthSpend: 20_000 }))
  assert.equal(result.daysElapsed, 10)
  assert.equal(result.projectedMonthSpend, 62_000)
  assert.equal(result.status, "on_track")
})

test("risk score always stays inside its documented range", () => {
  const result = riskScore(context({ monthSpend: 999_999, highRiskSpend3: 999_999 }))
  assert.ok(result.score >= 0)
  assert.ok(result.score <= 100)
})
