"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const items = [
  { href: "/", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/forecast", label: "Forecast" },
  { href: "/chat", label: "Kifayat Chat" },
]

export function Nav() {
  const path = usePathname()
  return (
    <header className="border-b border-default sticky top-0 z-30 backdrop-blur-md bg-[rgba(11,13,18,0.85)]">
      <div className="mx-auto flex max-w-6xl flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="text-primary">●</span>
          <span>Kifayat</span>
          <span className="hidden text-xs text-muted ml-1 sm:inline">AI Finance</span>
        </Link>
        <nav aria-label="Primary navigation" className="flex items-center gap-1 overflow-x-auto text-sm pb-1 sm:pb-0">
          {items.map((it) => {
            const active = path === it.href || (it.href !== "/" && path.startsWith(it.href))
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "shrink-0 rounded-md px-3 py-2 transition-colors",
                  active ? "bg-card text-primary" : "text-muted hover:text-white hover:bg-card",
                )}
              >
                {it.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
