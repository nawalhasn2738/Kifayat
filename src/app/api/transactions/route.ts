import { prisma } from "@/lib/db"
import { DEMO_USER_ID } from "@/lib/chat/tools"
import { z } from "zod"
import { embed, float32ToBytes } from "@/lib/rag/embed"
import { invalidateCache } from "@/lib/rag/retrieve"

export const runtime = "nodejs"

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const requestedPage = Number.parseInt(searchParams.get("page") ?? "1", 10)
  const requestedPageSize = Number.parseInt(searchParams.get("pageSize") ?? "20", 10)
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(1, Math.min(50, requestedPageSize))
    : 20
  const category = searchParams.get("category") ?? undefined

  const where = {
    userId: DEMO_USER_ID,
    ...(category ? { category: { name: category } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { category: true, account: true },
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.transaction.count({ where }),
  ])

  return Response.json({ items, total, page, pageSize })
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const DateSchema = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Invalid date",
})

const CreateSchema = z.object({
  date: DateSchema,
  amount: z.number().int().positive(),
  type: z.enum(["income", "expense"]),
  categoryId: z.number().int().positive().nullable().optional(),
  accountId: z.number().int().positive(),
  merchant: z.string().max(100).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
})

const UpdateSchema = z.object({
  id: z.number().int().positive(),
  date: DateSchema.optional(),
  amount: z.number().int().positive().optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  accountId: z.number().int().positive().optional(),
  merchant: z.string().max(100).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
})

const DeleteSchema = z.object({ id: z.number().int().positive() })

// ─── Helper: fire-and-forget embedding ───────────────────────────────────────

function embedAsync(
  txId: number,
  merchant: string | null,
  categoryName: string | null,
  description: string | null,
  amount: number,
  date: Date,
) {
  const text = `${merchant ?? ""} | ${categoryName ?? ""} | ${description ?? ""} | PKR ${Math.abs(amount)} | ${date.toISOString().slice(0, 10)}`
  embed(text)
    .then((vec) =>
      prisma.transaction
        .update({ where: { id: txId }, data: { embedding: Buffer.from(float32ToBytes(vec)) } })
        .then(() => invalidateCache(DEMO_USER_ID))
        .catch((error) => console.error("[transactions] embedding update failed", error)),
    )
    .catch((error) => console.error("[transactions] embedding failed", error))
}

async function accountBelongsToDemoUser(accountId: number) {
  return prisma.account.findFirst({ where: { id: accountId, userId: DEMO_USER_ID } })
}

// ─── POST — create ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.errors }, { status: 400 })

  const { date, amount, type, categoryId, accountId, merchant, description } = parsed.data
  if (!(await accountBelongsToDemoUser(accountId))) {
    return Response.json({ error: "Account not found" }, { status: 404 })
  }
  const signedAmount = type === "income" ? amount : -amount

  const [tx] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        userId: DEMO_USER_ID,
        accountId,
        categoryId: categoryId ?? null,
        date: new Date(date),
        amount: signedAmount,
        type,
        merchant: merchant ?? null,
        description: description ?? null,
      },
      include: { category: true, account: true },
    }),
    prisma.account.update({
      where: { id: accountId },
      data: { balance: { increment: signedAmount } },
    }),
  ])

  embedAsync(tx.id, tx.merchant, tx.category?.name ?? null, tx.description, tx.amount, tx.date)

  return Response.json(tx, { status: 201 })
}

// ─── PATCH — update ───────────────────────────────────────────────────────────

export async function PATCH(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.errors }, { status: 400 })

  const { id, date, amount, type, categoryId, accountId, merchant, description } = parsed.data

  const existing = await prisma.transaction.findUnique({
    where: { id },
    include: { category: true },
  })
  if (!existing || existing.userId !== DEMO_USER_ID) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const newType = type ?? existing.type
  const newAmount = amount !== undefined ? amount : Math.abs(existing.amount)
  const newAccountId = accountId ?? existing.accountId
  if (!(await accountBelongsToDemoUser(newAccountId))) {
    return Response.json({ error: "Account not found" }, { status: 404 })
  }
  const newSignedAmount = newType === "income" ? newAmount : -newAmount

  const updateData = {
    amount: newSignedAmount,
    type: newType,
    ...(date ? { date: new Date(date) } : {}),
    ...(categoryId !== undefined ? { categoryId: categoryId ?? null } : {}),
    accountId: newAccountId,
    ...(merchant !== undefined ? { merchant: merchant ?? null } : {}),
    ...(description !== undefined ? { description: description ?? null } : {}),
  }

  let tx: typeof existing & { account: { id: number; name: string; balance: number; type: string; userId: number } }

  if (newAccountId === existing.accountId) {
    const results = await prisma.$transaction([
      prisma.transaction.update({
        where: { id },
        data: updateData,
        include: { category: true, account: true },
      }),
      prisma.account.update({
        where: { id: newAccountId },
        data: { balance: { increment: newSignedAmount - existing.amount } },
      }),
    ])
    tx = results[0] as typeof tx
  } else {
    const results = await prisma.$transaction([
      prisma.transaction.update({
        where: { id },
        data: updateData,
        include: { category: true, account: true },
      }),
      prisma.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: -existing.amount } },
      }),
      prisma.account.update({
        where: { id: newAccountId },
        data: { balance: { increment: newSignedAmount } },
      }),
    ])
    tx = results[0] as typeof tx
  }

  embedAsync(tx.id, tx.merchant, tx.category?.name ?? null, tx.description, tx.amount, tx.date)

  return Response.json(tx)
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = DeleteSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.errors }, { status: 400 })

  const { id } = parsed.data

  const existing = await prisma.transaction.findUnique({ where: { id } })
  if (!existing || existing.userId !== DEMO_USER_ID) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.transaction.delete({ where: { id } }),
    prisma.account.update({
      where: { id: existing.accountId },
      data: { balance: { increment: -existing.amount } },
    }),
  ])
  invalidateCache(DEMO_USER_ID)

  return Response.json({ ok: true })
}
