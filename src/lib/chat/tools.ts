/**
 * Tool definitions handed to Groq via the Vercel AI SDK.
 *
 * Why tools (see plan §9.7):
 *   The LLM never produces numbers; it explains numbers that come from these tools.
 *   This is the project's primary anti-hallucination guarantee.
 */
import { tool } from "ai"
import { z } from "zod"
import {
  affordability,
  buildContext,
  goalProgress,
  installmentSafety,
  monthlyHealth,
  riskScore,
  savingsRecommendation,
} from "@/lib/finance/rules"
import {
  getCategoryBreakdownService,
  getSnapshot,
} from "@/lib/finance/snapshot"
import { listAnomalies, runForecast } from "@/lib/forecast/engine"
import { retrieveSimilar } from "@/lib/rag/retrieve"
import { getAnalysisDate } from "@/lib/finance/clock"

export const DEMO_USER_ID = 1

export function buildTools(userId: number = DEMO_USER_ID) {
  return {
    getFinancialSnapshot: tool({
      description:
        "Get the user's current finances at a glance: balances per account, income/spend MTD, projected month-end spend, savings rate, top spending categories this month, last 3 months totals.",
      parameters: z.object({}),
      execute: async () => getSnapshot(userId),
    }),

    getCategoryBreakdown: tool({
      description:
        "Spending breakdown by category over a window. Use when user asks 'how much on X', 'what is my biggest category', 'what am I overspending on'.",
      parameters: z.object({
        window: z.enum(["this_month", "last_month", "last_3_months"]),
        categories: z
          .array(z.string())
          .optional()
          .describe("Optional list of category names to filter to"),
      }),
      execute: async ({ window, categories }) =>
        getCategoryBreakdownService(userId, window, getAnalysisDate(), categories),
    }),

    getForecast: tool({
      description:
        "Forecast next month's spending per category and total, with confidence intervals. Method: EWMA (α=0.5) + linear trend blend. Honest about n=3 limits.",
      parameters: z.object({}),
      execute: async () => runForecast(userId),
    }),

    runAffordability: tool({
      description:
        "Check if the user can afford an item now or in N months given current balances, spending pace, and the 3-month emergency-fund buffer. Use for 'can I afford X', 'when can I buy X', 'is X safe to buy'.",
      parameters: z.object({
        itemName: z.string().describe("What the user wants to buy"),
        price: z.number().int().positive().describe("Price in PKR (whole rupees)"),
        monthsAhead: z
          .number()
          .int()
          .min(0)
          .max(36)
          .default(0)
          .describe("0 = check ability to buy now; N>0 = check after N months of saving at current rate"),
      }),
      execute: async (args) => {
        const ctx = await buildContext(userId)
        return affordability(ctx, args)
      },
    }),

    runInstallmentSafety: tool({
      description:
        "Evaluate whether financing X over N months at given APR is safe given the user's disposable income (income minus essential expenses). Returns EMI and ratio.",
      parameters: z.object({
        price: z.number().int().positive(),
        months: z.number().int().min(1).max(60),
        apr: z.number().min(0).max(1).default(0),
      }),
      execute: async (args) => {
        const ctx = await buildContext(userId)
        return installmentSafety(ctx, args)
      },
    }),

    getRiskScore: tool({
      description:
        "Compute the user's financial risk score (0-100), classification band (low/moderate/high), and the breakdown of contributing factors (spend-to-income, volatility, savings rate, high-risk share, anomaly share).",
      parameters: z.object({}),
      execute: async () => {
        const ctx = await buildContext(userId)
        return riskScore(ctx)
      },
    }),

    getMonthlyHealth: tool({
      description:
        "Project this month's total spend at the current daily pace and compare against the 3-month baseline. Use for 'am I overspending this month' or 'can I safely spend X this month'.",
      parameters: z.object({}),
      execute: async () => {
        const ctx = await buildContext(userId)
        return monthlyHealth(ctx)
      },
    }),

    getSavingsRecommendation: tool({
      description:
        "Recommend a monthly savings amount based on income, recent expense average, and 50/30/20 baseline. Use for 'how much should I save'.",
      parameters: z.object({}),
      execute: async () => {
        const ctx = await buildContext(userId)
        return savingsRecommendation(ctx)
      },
    }),

    retrieveSimilarTransactions: tool({
      description:
        "Semantic search over the user's actual transactions. Use for fuzzy questions like 'that big purchase last week', 'food trips with friends', 'the Daraz order I regretted'. Returns top-k most relevant transactions with date, merchant, description, amount, category.",
      parameters: z.object({
        query: z.string().describe("Free-form search query"),
        k: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, k }) => {
        const items = await retrieveSimilar(userId, query, k)
        return { query, items }
      },
    }),

    getAnomalies: tool({
      description:
        "List unusual transactions in the last 3 months: amounts >2.5σ above their category mean, plus any transaction marked as anomaly.",
      parameters: z.object({}),
      execute: async () => listAnomalies(userId),
    }),

    getSavingsGoalProgress: tool({
      description:
        "Progress on user's savings goals (e.g., 'iPhone 15', 'Emergency Fund'): saved so far, remaining, months to go at current savings rate, whether on track for target date.",
      parameters: z.object({
        goalName: z.string().optional().describe("Optional name to filter to a single goal"),
      }),
      execute: async ({ goalName }) => {
        const ctx = await buildContext(userId)
        return goalProgress(userId, ctx, goalName)
      },
    }),
  }
}
