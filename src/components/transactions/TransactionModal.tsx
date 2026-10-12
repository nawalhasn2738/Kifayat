"use client"

import { useEffect, useState } from "react"

type Category = { id: number; name: string; parent: string | null }
type Account = { id: number; name: string; type: string; balance: number }

export type TransactionItem = {
  id: number
  date: string
  amount: number
  type: string
  merchant: string | null
  description: string | null
  isAnomaly: boolean
  category: { id: number; name: string } | null
  account: { id: number; name: string; type: string }
}

type Props = {
  variant: "income" | "expense" | "edit"
  initialData?: TransactionItem
  onSuccess: () => void
  onClose: () => void
}

const QUICK_EXPENSE = [
  { name: "food_delivery", label: "Food",     icon: "🍔" },
  { name: "groceries",     label: "Grocery",  icon: "🛒" },
  { name: "fuel",          label: "Fuel",     icon: "⛽" },
  { name: "transport",     label: "Taxi",     icon: "🚕" },
  { name: "utilities",     label: "Bills",    icon: "💡" },
  { name: "online_shopping", label: "Shopping", icon: "🛍️" },
]

const QUICK_INCOME = [
  { name: "salary",    label: "Salary",    icon: "💼" },
  { name: "freelance", label: "Freelance", icon: "💻" },
]

const fmtBal = (n: number) => new Intl.NumberFormat("en-PK").format(n)

const HEADER = {
  income:  { bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.3)",  icon: "↑", title: "Record Income",     cls: "text-success" },
  expense: { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.25)", icon: "↓", title: "Log Expense",       cls: "text-danger"  },
  edit:    { bg: "rgba(124,92,255,0.12)",  border: "rgba(124,92,255,0.25)", icon: "✎", title: "Edit Transaction",  cls: ""             },
} as const

const SUBMIT_STYLE = {
  income:  { background: "var(--success)", color: "#fff" },
  expense: { background: "var(--danger)",  color: "#fff" },
  edit:    { background: "var(--primary)", color: "#fff" },
} as const

const SUBMIT_LABEL = {
  income:  "Record Income →",
  expense: "Log Expense →",
  edit:    "Save Changes",
} as const

export default function TransactionModal({ variant, initialData, onSuccess, onClose }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts]   = useState<Account[]>([])
  const [showAllCats, setShowAllCats] = useState(false)

  const [date,        setDate]       = useState(initialData?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [amount,      setAmount]     = useState(initialData ? String(Math.abs(initialData.amount)) : "")
  const [txType,      setTxType]     = useState<"income" | "expense" | "transfer">(
    variant === "income"  ? "income"  :
    variant === "expense" ? "expense" :
    (initialData?.type as "income" | "expense" | "transfer") ?? "expense"
  )
  const [categoryId,  setCategoryId] = useState<string>(initialData?.category ? String(initialData.category.id) : "")
  const [accountId,   setAccountId]  = useState<string>(initialData ? String(initialData.account.id) : "")
  const [merchant,    setMerchant]   = useState(initialData?.merchant ?? "")
  const [description, setDescription] = useState(initialData?.description ?? "")
  const [loading,     setLoading]    = useState(false)
  const [error,       setError]      = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
    ]).then(([cats, accs]: [Category[], Account[]]) => {
      setCategories(cats)
      setAccounts(accs)
      if (!initialData && accs.length > 0) setAccountId(String(accs[0].id))
    })
  }, [initialData])

  function selectQuickCat(name: string) {
    const cat = categories.find((c) => c.name === name)
    if (cat) { setCategoryId(String(cat.id)); setShowAllCats(false) }
  }

  const grouped = categories.reduce<Record<string, Category[]>>((acc, cat) => {
    const p = cat.parent ?? "Other"
    acc[p] = [...(acc[p] ?? []), cat]
    return acc
  }, {})

  const incomeCategories  = categories.filter((c) => c.parent === "Income")
  const expenseCategories = categories.filter((c) => c.parent !== "Income" && c.parent !== "Transfer")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const n = parseInt(amount, 10)
    if (!n || n <= 0) { setError("Amount must be a positive whole number (PKR)."); return }
    if (!accountId)   { setError("Select an account."); return }

    setLoading(true)
    try {
      const isEdit = variant === "edit"
      const res = await fetch("/api/transactions", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { id: initialData!.id } : {}),
          date, amount: n, type: txType,
          categoryId: categoryId ? parseInt(categoryId, 10) : null,
          accountId:  parseInt(accountId, 10),
          merchant:    merchant    || null,
          description: description || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: unknown }
        throw new Error(d.error ? JSON.stringify(d.error) : "Request failed")
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  const h = HEADER[variant]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-dialog-title"
        className="rounded-xl border overflow-hidden w-full max-w-lg mx-4 overflow-y-auto max-h-[90vh]"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        {/* ── Colored header strip ── */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: h.bg, borderBottom: `1px solid ${h.border}` }}
        >
          <div className="flex items-center gap-2">
            <span className={`text-xl font-bold ${h.cls}`}>{h.icon}</span>
            <span id="transaction-dialog-title" className={`font-semibold text-base ${h.cls}`}>{h.title}</span>
          </div>
          <button type="button" aria-label="Close transaction dialog" className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>✕</button>
        </div>

        {/* ── Form body ── */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* ════════ INCOME ════════ */}
          {variant === "income" && (
            <>
              {/* Large amount */}
              <div>
                <label className="block text-xs text-muted mb-1">Amount Received (PKR) *</label>
                <input
                  type="number" className="input" placeholder="e.g. 120000"
                  value={amount} min={1} step={1}
                  onChange={(e) => setAmount(e.target.value)} required
                  style={{ fontSize: "1.15rem", fontWeight: 600 }}
                  autoFocus
                />
              </div>

              {/* Income type chips */}
              <div>
                <label className="block text-xs text-muted mb-2">Income Type</label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_INCOME.map((q) => {
                    const cat = categories.find((c) => c.name === q.name)
                    const active = !!(cat && categoryId === String(cat.id))
                    return (
                      <button key={q.name} type="button" onClick={() => selectQuickCat(q.name)}
                        style={{
                          padding: "6px 14px", cursor: "pointer", borderRadius: "8px",
                          background: active ? "rgba(52,211,153,0.22)" : "transparent",
                          border: `1px solid ${active ? "var(--success)" : "var(--border)"}`,
                          color: active ? "var(--success)" : "var(--fg)",
                          fontWeight: active ? 600 : 400, fontSize: "0.875rem",
                        }}
                      >
                        {q.icon} {q.label}
                      </button>
                    )
                  })}
                  <button type="button"
                    onClick={() => setShowAllCats((v) => !v)}
                    style={{
                      padding: "6px 14px", cursor: "pointer", borderRadius: "8px",
                      background: showAllCats ? "rgba(52,211,153,0.1)" : "transparent",
                      border: "1px solid var(--border)", color: "var(--fg-muted)", fontSize: "0.875rem",
                    }}
                  >
                    + Other
                  </button>
                </div>
                {showAllCats && (
                  <select className="input mt-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">— none —</option>
                    {incomeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>

              {/* Source + Date */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-muted mb-1">Source / Payer</label>
                  <input type="text" className="input" placeholder="e.g. Client, company"
                    maxLength={100} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Date *</label>
                  <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
              </div>

              {/* Deposit into — shows balance */}
              <div>
                <label className="block text-xs text-muted mb-1">Deposit into *</label>
                <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="">— select account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}  ·  PKR {fmtBal(a.balance)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* ════════ EXPENSE ════════ */}
          {variant === "expense" && (
            <>
              {/* Quick category chips */}
              <div>
                <label className="block text-xs text-muted mb-2">Quick Category</label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_EXPENSE.map((q) => {
                    const cat = categories.find((c) => c.name === q.name)
                    const active = !!(cat && categoryId === String(cat.id))
                    return (
                      <button key={q.name} type="button" onClick={() => selectQuickCat(q.name)}
                        style={{
                          padding: "6px 12px", cursor: "pointer", borderRadius: "8px",
                          background: active ? "rgba(248,113,113,0.18)" : "transparent",
                          border: `1px solid ${active ? "var(--danger)" : "var(--border)"}`,
                          color: active ? "var(--danger)" : "var(--fg)",
                          fontWeight: active ? 600 : 400, fontSize: "0.875rem",
                        }}
                      >
                        {q.icon} {q.label}
                      </button>
                    )
                  })}
                  <button type="button"
                    onClick={() => setShowAllCats((v) => !v)}
                    style={{
                      padding: "6px 12px", cursor: "pointer", borderRadius: "8px",
                      background: showAllCats ? "rgba(248,113,113,0.1)" : "transparent",
                      border: "1px solid var(--border)", color: "var(--fg-muted)", fontSize: "0.875rem",
                    }}
                  >
                    ≡ More
                  </button>
                </div>
                {showAllCats && (
                  <select className="input mt-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">— none —</option>
                    {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>

              {/* Amount + Account */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-muted mb-1">Amount Spent (PKR) *</label>
                  <input type="number" className="input" placeholder="e.g. 800"
                    value={amount} min={1} step={1}
                    onChange={(e) => setAmount(e.target.value)} required autoFocus />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Paid from *</label>
                  <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                    <option value="">— select —</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Merchant + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Merchant / Store</label>
                  <input type="text" className="input" placeholder="e.g. Foodpanda"
                    maxLength={100} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Date *</label>
                  <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
              </div>

            </>
          )}

          {/* ════════ EDIT (neutral, all fields) ════════ */}
          {variant === "edit" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-muted mb-1">Date *</label>
                <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Type *</label>
                <select className="input" value={txType} onChange={(e) => setTxType(e.target.value as typeof txType)} required>
                  {(["income", "expense", "transfer"] as const).map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Amount (PKR) *</label>
                <input type="number" className="input" placeholder="e.g. 800"
                  value={amount} min={1} step={1}
                  onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Account *</label>
                <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="">— select —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Category</label>
                <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">— none —</option>
                  {Object.entries(grouped).map(([parent, cats]) => (
                    <optgroup key={parent} label={parent}>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Merchant</label>
                <input type="text" className="input" placeholder="e.g. Foodpanda"
                  maxLength={100} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Description (all variants) ── */}
          <div>
            <label className="block text-xs text-muted mb-1">
              {variant === "income" ? "Note (optional)" : "Description (optional)"}
            </label>
            <textarea
              className="input" rows={2} maxLength={500}
              placeholder={variant === "income" ? "What's this income for?" : "Any details…"}
              value={description} onChange={(e) => setDescription(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn flex-1" style={SUBMIT_STYLE[variant]} disabled={loading}>
              {loading ? "Saving…" : SUBMIT_LABEL[variant]}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
