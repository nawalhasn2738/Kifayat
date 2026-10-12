"use client"

import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export function MonthlyTrend({
  data,
}: {
  data: { month: string; income: number; expense: number; savings: number }[]
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Recharts needs browser layout information before ResponsiveContainer renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">Income vs Expense (last 3 months)</h3>
        <span className="text-xs text-muted">PKR</span>
      </div>
      <div className="h-64">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="#1f2536" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#8b90a3" fontSize={12} />
              <YAxis stroke="#8b90a3" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: "#131722",
                  border: "1px solid #1f2536",
                  borderRadius: 8,
                  color: "#e8eaf0",
                }}
                formatter={(v: unknown) =>
                  typeof v === "number" ? `PKR ${v.toLocaleString("en-PK")}` : String(v ?? "")
                }
              />
              <Legend wrapperStyle={{ color: "#8b90a3", fontSize: 12 }} />
              <Bar dataKey="income" fill="#34d399" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#f87171" radius={[4, 4, 0, 0]} />
              <Bar dataKey="savings" fill="#7c5cff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full" />
        )}
      </div>
    </div>
  )
}
