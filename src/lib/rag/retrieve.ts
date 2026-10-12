import { prisma } from "@/lib/db"
import { bytesToFloat32, cosine, embed } from "@/lib/rag/embed"

const memoryCache: Map<
  number,
  Array<{
    id: number
    vec: Float32Array
    text: string
    date: Date
    merchant: string | null
    description: string | null
    amount: number
    category: string | null
  }>
> = new Map()

let cacheLoadedAt = 0
const CACHE_TTL_MS = 60_000 // 1 min — fresh enough for demo, fast on repeat queries

async function loadIfStale(userId: number) {
  const now = Date.now()
  if (memoryCache.has(userId) && now - cacheLoadedAt < CACHE_TTL_MS) return
  const rows = await prisma.transaction.findMany({
    where: { userId, embedding: { not: null } },
    include: { category: true },
  })
  const list: Array<{
    id: number
    vec: Float32Array
    text: string
    date: Date
    merchant: string | null
    description: string | null
    amount: number
    category: string | null
  }> = []
  for (const r of rows) {
    if (!r.embedding) continue
    list.push({
      id: r.id,
      vec: bytesToFloat32(new Uint8Array(r.embedding)),
      text: txText(r),
      date: r.date,
      merchant: r.merchant,
      description: r.description,
      amount: r.amount,
      category: r.category?.name ?? null,
    })
  }
  memoryCache.set(userId, list)
  cacheLoadedAt = now
}

export function txText(r: {
  merchant: string | null
  description: string | null
  amount: number
  date: Date
  category?: { name: string } | null
}) {
  return [
    r.merchant ?? "",
    r.category?.name ?? "",
    r.description ?? "",
    `PKR ${Math.abs(r.amount)}`,
    r.date.toISOString().slice(0, 10),
  ]
    .filter(Boolean)
    .join(" | ")
}

export async function retrieveSimilar(userId: number, query: string, k = 5) {
  await loadIfStale(userId)
  const list = memoryCache.get(userId) ?? []
  if (list.length === 0) return []
  const q = await embed(query)
  const now = Date.now()
  const scored = list.map((r) => {
    const cos = cosine(q, r.vec)
    const ageDays = (now - r.date.getTime()) / (1000 * 3600 * 24)
    const recencyBoost = 0.05 * Math.exp(-ageDays / 30)
    return { ...r, score: cos + recencyBoost }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    merchant: r.merchant,
    description: r.description,
    amount: r.amount,
    category: r.category,
    score: Math.round(r.score * 1000) / 1000,
  }))
}

export function invalidateCache(userId: number) {
  memoryCache.delete(userId)
  cacheLoadedAt = 0
}
