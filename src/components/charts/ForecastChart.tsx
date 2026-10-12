"use client"

import { useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type Row = {
  category: string
  blend: number
  errLow: number
  errHigh: number
}

export function ForecastChart({
  forecast,
}: {
  forecast: {
    byCategory: Record<string, { blend: number; low: number; high: number }>
    total: { blend: number; low: number; high: number }
    method: string
  }
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Recharts needs browser layout information before ResponsiveContainer renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const rows: Row[] = Object.entries(forecast.byCategory)
    .map(([category, v]) => ({
      category,
      blend: v.blend,
      errLow: Math.max(0, v.blend - v.low),
      errHigh: Math.max(0, v.high - v.blend),
    }))
    .sort((a, b) => b.blend - a.blend)
    .slice(0, 10)

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">Next-month forecast (per category)</h3>
        <span className="text-xs text-muted">
          Total: PKR {forecast.total.blend.toLocaleString("en-PK")} (±σ)
        </span>
      </div>
      <div className="h-72">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid stroke="#1f2536" strokeDasharray="3 3" />
              <XAxis type="number" stroke="#8b90a3" fontSize={11} />
              <YAxis
                type="category"
                dataKey="category"
                stroke="#8b90a3"
                fontSize={11}
                width={120}
              />
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
              <Bar dataKey="blend" fill="#7c5cff" radius={[0, 4, 4, 0]}>
                <ErrorBar
                  dataKey="errHigh"
                  width={4}
                  stroke="#fbbf24"
                  direction="x"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full" />
        )}
      </div>
      <p className="mt-3 text-xs text-muted">{forecast.method}</p>
    </div>
  )
}
