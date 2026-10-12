/**
 * Forecast engine.
 *
 * Why this design (see plan §7):
 *   We have 3 monthly aggregates per category. Deep models (Prophet, LSTM, TFT) need
 *   ≥12 months and would overfit catastrophically on n=3. We use:
 *     • EWMA (α=0.5) — recency-weighted average
 *     • Linear trend slope across the 3 months
 *     • Blend = 0.6 * EWMA + 0.4 * (EWMA + 0.4 * trend)
 *     • Confidence band ≈ ±1σ of the 3 monthly values
 *   This is honest, explainable, and demoable.
 */
import { prisma } from "@/lib/db"
import { ForecastResult } from "@/lib/types"
import { mean, stdev, ymKey } from "@/lib/finance/helpers"
import { getAnalysisDate } from "@/lib/finance/clock"

const ALPHA = 0.5

function ewma(values: number[], alpha = ALPHA) {
  if (values.length === 0) return 0
  let s = values[0]
  for (let i = 1; i < values.length; i++) s = alpha * values[i] + (1 - alpha) * s
  return s
}

function linearTrendSlope(values: number[]) {
  // x = [0, 1, ..., n-1], y = values. Returns slope (PKR per month).
  if (values.length < 2) return 0
  const n = values.length
  const xs = Array.from({ length: n }, (_, i) => i)
  const xm = mean(xs)
  const ym = mean(values)
  let num = 0,
    den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xm) * (values[i] - ym)
    den += (xs[i] - xm) ** 2
  }
  return den === 0 ? 0 : num / den
}

export async function runForecast(userId: number, asOf = getAnalysisDate()): Promise<ForecastResult> {
  // Look at the previous three full months relative to current month.
  // For our seed (today=2026-05-10), this means Feb, Mar, Apr 2026.
  const startWindow = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1) // Feb 1
  const endWindow = new Date(asOf.getFullYear(), asOf.getMonth(), 0, 23, 59, 59, 999) // last day of prev month

  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      type: "expense",
      date: { gte: startWindow, lte: endWindow },
    },
    include: { category: true },
  })

  // Aggregate per category × month.
  const months: string[] = []
  for (let i = 3; i >= 1; i--) {
    months.push(ymKey(new Date(asOf.getFullYear(), asOf.getMonth() - i, 1)))
  }

  const perCat = new Map<string, Record<string, number>>() // category -> ym -> total
  for (const t of txs) {
    if (!t.category) continue
    const ym = ymKey(t.date)
    const cat = t.category.name
    if (!perCat.has(cat)) perCat.set(cat, {})
    perCat.get(cat)![ym] = (perCat.get(cat)![ym] ?? 0) + Math.abs(t.amount)
  }

  const byCategory: ForecastResult["byCategory"] = {}
  let totalBlend = 0,
    totalLow = 0,
    totalHigh = 0

  for (const [cat, monthBuckets] of perCat) {
    const series = months.map((m) => monthBuckets[m] ?? 0)
    const ew = ewma(series)
    const slope = linearTrendSlope(series)
    const projection = Math.max(0, ew + 0.4 * slope)
    const blend = 0.6 * ew + 0.4 * projection
    const sd = stdev(series)
    const low = Math.max(0, blend - sd)
    const high = blend + sd
    byCategory[cat] = {
      blend: Math.round(blend),
      low: Math.round(low),
      high: Math.round(high),
    }
    totalBlend += blend
    totalLow += low
    totalHigh += high
  }

  return {
    total: {
      blend: Math.round(totalBlend),
      low: Math.round(totalLow),
      high: Math.round(totalHigh),
    },
    byCategory,
    method:
      "EWMA(α=0.5) + linear trend blend, 60/40 weighting; confidence ±1σ over 3 months. Chosen because n=3 makes deeper models (Prophet/LSTM/TFT) statistically unreliable.",
    asOf: asOf.toISOString(),
  }
}

export async function listAnomalies(userId: number, asOf = getAnalysisDate()) {
  // Per-category transaction-level z-score over last 3 months.
  const start = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1)
  const end = new Date(asOf.getFullYear(), asOf.getMonth(), 0, 23, 59, 59, 999)
  const txs = await prisma.transaction.findMany({
    where: { userId, type: "expense", date: { gte: start, lte: end } },
    include: { category: true },
  })
  const grouped = new Map<string, typeof txs>()
  for (const t of txs) {
    if (!t.category) continue
    const k = t.category.name
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(t)
  }
  const flagged: Array<{
    id: number
    date: string
    merchant: string | null
    description: string | null
    amount: number
    category: string
    zscore: number
    reason: string
  }> = []
  for (const [cat, list] of grouped) {
    const amounts = list.map((t) => Math.abs(t.amount))
    const m = mean(amounts)
    const s = stdev(amounts)
    if (s === 0) continue
    for (const t of list) {
      const z = (Math.abs(t.amount) - m) / s
      if (z >= 2.5 || t.isAnomaly) {
        flagged.push({
          id: t.id,
          date: t.date.toISOString(),
          merchant: t.merchant,
          description: t.description,
          amount: Math.abs(t.amount),
          category: cat,
          zscore: Math.round(z * 100) / 100,
          reason: t.isAnomaly
            ? "Marked as one-off anomaly during data ingestion"
            : `Amount is ${z.toFixed(1)}σ above mean of category '${cat}' (mean ${Math.round(m)})`,
        })
      }
    }
  }
  return flagged.sort((a, b) => b.amount - a.amount)
}
