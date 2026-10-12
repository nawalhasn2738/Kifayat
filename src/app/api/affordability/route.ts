import { buildContext, affordability } from "@/lib/finance/rules"
import { DEMO_USER_ID } from "@/lib/chat/tools"
import { z } from "zod"

const Schema = z.object({
  itemName: z.string().default("Item"),
  price: z.number().int().positive(),
  monthsAhead: z.number().int().min(0).max(36).default(0),
})

export const runtime = "nodejs"

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const ctx = await buildContext(DEMO_USER_ID)
  return Response.json(affordability(ctx, parsed.data))
}
