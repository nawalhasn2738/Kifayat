import Link from "next/link"
import { KpiCard } from "@/components/KpiCard"
import { RiskBadge } from "@/components/RiskBadge"
import { MonthlyTrend } from "@/components/charts/MonthlyTrend"
import { CategoryPie } from "@/components/charts/CategoryPie"
import { getSnapshot } from "@/lib/finance/snapshot"
import { buildContext, riskScore, monthlyHealth } from "@/lib/finance/rules"
import { fmtPKR } from "@/lib/finance/helpers"
import { DEMO_USER_ID } from "@/lib/chat/tools"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function OverviewPage() {
  const snapshot = await getSnapshot(DEMO_USER_ID)
  const ctx = await buildContext(DEMO_USER_ID)
  const risk = riskScore(ctx)
  const health = monthlyHealth(ctx)
  const recent = await prisma.transaction.findMany({
    where: { userId: DEMO_USER_ID },
    include: { category: true, account: true },
    orderBy: { date: "desc" },
    take: 8,
  })

  const savingsRatePct = Math.round(snapshot.savings.rate * 100)
  const projectedTone =
    health.status === "on_track" ? "success" : health.status === "watch" ? "warning" : "danger"

  const pieData =
    snapshot.topCategoriesMTD.length > 0
      ? snapshot.topCategoriesMTD
      : ctx.stats3.slice(0, 6)

  return (
    <div className="space-y-6">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-muted text-sm flex items-center gap-2">
            As of {new Date(snapshot.asOf).toLocaleDateString("en-PK")} ·{" "}
            <RiskBadge band={risk.band} score={risk.score} />
          </p>
        </div>
        <Link href="/chat" className="btn btn-primary">
          Ask Kifayat →
        </Link>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Liquid balance"
          value={fmtPKR(snapshot.totalBalance)}
          hint={`${snapshot.balances.length} accounts`}
        />
        <KpiCard
          label="Spend MTD"
          value={fmtPKR(snapshot.spend.thisMonthMTD)}
          hint={`Projected month-end: ${fmtPKR(snapshot.spend.thisMonthProjected)}`}
          tone={projectedTone}
        />
        <KpiCard
          label="3-month savings rate"
          value={`${savingsRatePct}%`}
          hint={`${fmtPKR(snapshot.savings.threeMonthAvg)}/mo · target 20%`}
          tone={savingsRatePct >= 20 ? "success" : savingsRatePct >= 12 ? "warning" : "danger"}
        />
        <KpiCard
          label="Income (this month)"
          value={fmtPKR(snapshot.income.thisMonth)}
          hint={`3-mo avg ${fmtPKR(snapshot.income.threeMonthAvg)}`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <MonthlyTrend data={snapshot.monthlyTotals} />
        <CategoryPie data={pieData} />
      </div>

      <div className="card">
        <h3 className="mb-3 font-medium">Why this risk band?</h3>
        <ul className="text-sm text-muted space-y-1 list-disc list-inside">
          {risk.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-muted">
          {Object.entries(risk.breakdown).map(([k, v]) => (
            <div key={k} className="rounded-md border border-default px-2 py-1">
              <div className="text-[10px] uppercase">{k}</div>
              <div className="text-white text-sm">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Recent transactions</h3>
          <Link href="/transactions" className="text-xs text-primary">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
        <table className="min-w-[620px] w-full text-sm">
          <thead className="text-muted text-xs">
            <tr>
              <th className="text-left py-2">Date</th>
              <th className="text-left">Merchant</th>
              <th className="text-left">Category</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id} className="border-t border-default">
                <td className="py-2 text-muted">{t.date.toISOString().slice(0, 10)}</td>
                <td>{t.merchant ?? "—"}</td>
                <td className="text-muted">{t.category?.name ?? "—"}</td>
                <td
                  className={`text-right ${t.type === "income" ? "text-success" : t.amount < 0 ? "text-danger" : ""}`}
                >
                  {t.amount > 0 ? "+" : ""}
                  {fmtPKR(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
