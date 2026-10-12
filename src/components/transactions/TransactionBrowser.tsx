"use client"

import { useCallback, useEffect, useState } from "react"
import TransactionModal, { type TransactionItem } from "./TransactionModal"

const fmtPKR = (n: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(Math.abs(n))

type Category = { id: number; name: string }

export default function TransactionBrowser() {
  const [transactions, setTransactions] = useState<TransactionItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const [modalVariant, setModalVariant] = useState<"income" | "expense" | "edit" | null>(null)
  const [editTarget, setEditTarget] = useState<TransactionItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const PAGE_SIZE = 25

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (selectedCategory) params.set("category", selectedCategory)
    const res = await fetch(`/api/transactions?${params}`)
    const data = (await res.json()) as { items: TransactionItem[]; total: number }
    setTransactions(data.items)
    setTotal(data.total)
    setLoading(false)
  }, [page, selectedCategory, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Fetching is intentionally triggered whenever the memoized query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTransactions()
  }, [fetchTransactions])

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((cats: Category[]) => setCategories(cats))
  }, [])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function openEdit(tx: TransactionItem) {
    setEditTarget(tx)
    setModalVariant("edit")
  }

  function handleModalSuccess() {
    setModalVariant(null)
    setEditTarget(null)
    setPage(1)
    setRefreshKey((k) => k + 1)
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this transaction? This cannot be undone.")) return
    setDeleteError(null)
    const res = await fetch("/api/transactions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setPage(1)
      setRefreshKey((k) => k + 1)
    } else {
      setDeleteError("Failed to delete. Try again.")
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transactions</h1>
          <p className="text-muted text-sm">
            {total} total · page {page} / {pageCount}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn"
            style={{ background: "var(--success)", color: "#fff" }}
            onClick={() => { setEditTarget(null); setModalVariant("income") }}
          >
            ↑ Income
          </button>
          <button
            className="btn"
            style={{ background: "var(--danger)", color: "#fff" }}
            onClick={() => { setEditTarget(null); setModalVariant("expense") }}
          >
            ↓ Expense
          </button>
        </div>
      </header>

      {deleteError && (
        <p className="text-danger text-sm">{deleteError}</p>
      )}

      <div className="card">
        {/* Category filter chips */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <span className="text-muted">Category:</span>
          <button
            className={`badge ${!selectedCategory ? "badge-low" : "btn-ghost"}`}
            style={{ padding: "2px 8px", cursor: "pointer" }}
            onClick={() => { setSelectedCategory(null); setPage(1) }}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`badge ${selectedCategory === c.name ? "badge-low" : "btn-ghost"}`}
              style={{ padding: "2px 8px", cursor: "pointer" }}
              onClick={() => { setSelectedCategory(c.name); setPage(1) }}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-muted text-sm py-6 text-center">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="text-muted text-sm py-6 text-center">No transactions found.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="text-muted text-xs">
              <tr>
                <th className="text-left py-2">Date</th>
                <th className="text-left">Merchant</th>
                <th className="text-left">Category</th>
                <th className="text-left">Description</th>
                <th className="text-left">Type</th>
                <th className="text-left">Paid Via</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-t border-default">
                  <td className="py-2 text-muted">{t.date.slice(0, 10)}</td>
                  <td>{t.merchant ?? "—"}</td>
                  <td className="text-muted">{t.category?.name ?? "—"}</td>
                  <td className="text-muted">
                    {t.description ?? "—"}
                    {t.isAnomaly && (
                      <span className="ml-2 badge badge-high">anomaly</span>
                    )}
                  </td>
                  <td className="text-muted text-xs uppercase">{t.type}</td>
                  <td className="text-muted text-xs">
                    {t.account.type === "cash"
                      ? "Cash"
                      : t.account.type === "savings"
                        ? "Savings"
                        : t.account.name}
                  </td>
                  <td
                    className={`text-right ${
                      t.type === "income"
                        ? "text-success"
                        : t.amount < 0
                          ? "text-danger"
                          : ""
                    }`}
                  >
                    {t.amount > 0 ? "+" : "−"}
                    {fmtPKR(t.amount)}
                  </td>
                  <td className="text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        className="btn btn-ghost px-2 py-1 text-xs"
                        onClick={() => openEdit(t)}
                        title="Edit"
                      >
                        ✎
                      </button>
                      <button
                        className="btn btn-ghost px-2 py-1 text-xs text-danger"
                        onClick={() => handleDelete(t.id)}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            className="btn btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ← Prev
          </button>
          <span className="text-muted text-xs">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modalVariant && (
        <TransactionModal
          variant={modalVariant}
          initialData={editTarget ?? undefined}
          onSuccess={handleModalSuccess}
          onClose={() => { setModalVariant(null); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
