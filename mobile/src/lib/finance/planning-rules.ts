// Shared pure rules: no database, provider, platform or demo-user imports.
export const HEALTHY_SAVINGS_RATE = 0.20;
export const SAFE_INSTALLMENT_RATIO = 0.30;
export function calculateSavingsRecommendation(input: { income: number; expectedExpenses: number }) {
  const target = Math.round(input.income * HEALTHY_SAVINGS_RATE);
  const expectedExpenses = Math.round(input.expectedExpenses);
  const dynamicCap = Math.max(0, input.income - expectedExpenses);
  // A zero headroom must never fall back to a positive transfer recommendation.
  const recommended = Math.min(target, dynamicCap);
  return { targetByRule: target, expectedExpenses, headroom: dynamicCap, recommendedMonthlyTransfer: recommended,
    reason: dynamicCap < target
      ? `Income ${input.income} − expenses ${expectedExpenses} = headroom ${dynamicCap} which is below 20% target ${target}; suggesting headroom-aligned saving`
      : `20% of income (${target}) is achievable given headroom ${dynamicCap}; standard 50/30/20 rule applies` };
}
export function calculateInstallmentSafety(input: { income: number; essentialMonthlySpend: number }, args: { price: number; months: number; apr: number }) {
  const r = args.apr / 12;
  const monthly = args.apr === 0 ? Math.ceil(args.price / args.months)
    : Math.ceil((args.price * r * Math.pow(1 + r, args.months)) / (Math.pow(1 + r, args.months) - 1));
  const disposable = Math.max(1, input.income - Math.round(input.essentialMonthlySpend));
  const ratio = monthly / disposable;
  const safe = ratio <= SAFE_INSTALLMENT_RATIO;
  return { ...args, monthly, ratio: Math.round(ratio * 100) / 100, safe,
    reason: safe
      ? `EMI ${monthly} is ${(ratio * 100).toFixed(0)}% of disposable ${disposable}, within ${SAFE_INSTALLMENT_RATIO * 100}% safe ratio`
      : `EMI ${monthly} is ${(ratio * 100).toFixed(0)}% of disposable ${disposable}, EXCEEDS ${SAFE_INSTALLMENT_RATIO * 100}% safe ratio` };
}
