import { streamText, type CoreMessage } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import { buildTools, DEMO_USER_ID } from "@/lib/chat/tools"
import { z } from "zod"

export const runtime = "nodejs"
export const maxDuration = 60

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

const CHAT_COOLDOWN_MS = 8000
const lastChatRequestAt = new Map<string, number>()
const ChatRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(50),
})

function getClientErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const lower = message.toLowerCase()

  if (lower.includes("rate limit") || lower.includes("tpm") || lower.includes("429")) {
    return "Rate limit reached. Please wait a few seconds and try again."
  }

  return "Chat temporarily unavailable. Please try again."
}

export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.includes("your-groq")) {
    return Response.json(
      {
        error:
          "GROQ_API_KEY missing or placeholder. Edit .env.local and put a fresh key from https://console.groq.com/keys",
      },
      { status: 500 },
    )
  }

  const clientId = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
  const now = Date.now()
  const elapsed = now - (lastChatRequestAt.get(clientId) ?? 0)
  if (elapsed < CHAT_COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((CHAT_COOLDOWN_MS - elapsed) / 1000)
    return Response.json(
      {
        error: "Rate limit reached. Please wait a few seconds and try again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      },
    )
  }
  lastChatRequestAt.set(clientId, now)

  const parsed = ChatRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat request." }, { status: 400 })
  }
  const messages = parsed.data.messages as CoreMessage[]

  const system = await buildSystemPrompt(DEMO_USER_ID)
  const tools = buildTools(DEMO_USER_ID)

  const result = streamText({
    model: groq(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"),
    system,
    messages,
    tools,
    maxRetries: 0,
    maxSteps: 6,
    temperature: 0.3,
    onError({ error }) {
      console.error("[chat] streamText error", error)
    },
  })

  return result.toDataStreamResponse({
    getErrorMessage: getClientErrorMessage,
  })
}
