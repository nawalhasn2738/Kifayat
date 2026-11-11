// Finance rule constants. Tweak here, not in business logic.

export const EMERGENCY_FUND_MONTHS = 3
export { SAFE_INSTALLMENT_RATIO, HEALTHY_SAVINGS_RATE } from "../../../mobile/src/lib/finance/planning-rules"

// Categories the engine treats as discretionary / impulse-prone.
export const HIGH_RISK_CATEGORIES = new Set([
  "online_shopping",
  "dine_out",
  "food_delivery",
  "entertainment",
  "anomaly",
])

export const RISK_WEIGHTS = {
  spendToIncome: 0.35,
  volatility: 0.20,
  savingsRateInverse: 0.20,
  highRiskShare: 0.15,
  anomalyShare: 0.10,
}

// Catalog of expected categories used both by the seeder and the rule engine.
export const CATEGORIES: Array<{
  name: string
  parent: string
  isEssential: boolean
  isHighRisk: boolean
}> = [
  { name: "salary", parent: "Income", isEssential: false, isHighRisk: false },
  { name: "freelance", parent: "Income", isEssential: false, isHighRisk: false },
  { name: "groceries", parent: "Essentials", isEssential: true, isHighRisk: false },
  { name: "fuel", parent: "Essentials", isEssential: true, isHighRisk: false },
  { name: "utilities", parent: "Essentials", isEssential: true, isHighRisk: false },
  { name: "internet_mobile", parent: "Essentials", isEssential: true, isHighRisk: false },
  { name: "transport", parent: "Essentials", isEssential: true, isHighRisk: false },
  { name: "healthcare", parent: "Essentials", isEssential: true, isHighRisk: false },
  { name: "university", parent: "Obligations", isEssential: true, isHighRisk: false },
  { name: "family_support", parent: "Obligations", isEssential: true, isHighRisk: false },
  { name: "charity", parent: "Obligations", isEssential: false, isHighRisk: false },
  { name: "food_delivery", parent: "Lifestyle", isEssential: false, isHighRisk: true },
  { name: "dine_out", parent: "Lifestyle", isEssential: false, isHighRisk: true },
  { name: "subscriptions", parent: "Lifestyle", isEssential: false, isHighRisk: false },
  { name: "online_shopping", parent: "Lifestyle", isEssential: false, isHighRisk: true },
  { name: "entertainment", parent: "Lifestyle", isEssential: false, isHighRisk: true },
  { name: "personal_care", parent: "Lifestyle", isEssential: false, isHighRisk: false },
  { name: "savings_transfer", parent: "Transfer", isEssential: false, isHighRisk: false },
  { name: "anomaly", parent: "Anomaly", isEssential: false, isHighRisk: true },
]
