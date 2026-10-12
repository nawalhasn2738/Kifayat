import type { Metadata } from "next"
import "./globals.css"
import { Nav } from "@/components/Nav"

export const metadata: Metadata = {
  title: "Kifayat — AI Personal Finance",
  description:
    "AI-powered personal finance manager with grounded, tool-using chatbot for affordability, risk, forecasting, and savings advice.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-5 sm:py-6">{children}</main>
      </body>
    </html>
  )
}
