"use client"

import { useEffect, useState } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

const COLORS = [
  "#7c5cff",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#22d3ee",
  "#f472b6",
  "#facc15",
]

export function CategoryPie({
  data,
  title = "This-month spending by category",
}: {
  data: { category: string; total: number }[]
  title?: string
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
        <h3 className="font-medium">{title}</h3>
        <span className="text-xs text-muted">PKR</span>
      </div>
      <div className="h-64">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="total"
                nameKey="category"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#131722",
                  border: "1px solid #1f2536",
                  borderRadius: 8,
                  color: "#e8eaf0",
                }}
                formatter={(v: unknown, name: unknown) => [
                  typeof v === "number" ? `PKR ${v.toLocaleString("en-PK")}` : String(v ?? ""),
                  String(name ?? ""),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full" />
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
        {data.map((d, idx) => (
          <div key={d.category} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: COLORS[idx % COLORS.length] }}
            />
            <span className="text-muted">{d.category}</span>
            <span className="ml-auto">PKR {d.total.toLocaleString("en-PK")}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
