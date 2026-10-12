"use client"

import { useChat } from "ai/react"
import { useEffect, useRef } from "react"
import { ToolCallTrace } from "./ToolCallTrace"

const SAMPLE_QUESTIONS = [
  "Can I afford an iPhone in 6 months?",
  "What category am I overspending in?",
  "What will I spend next month?",
  "How risky is my spending right now?",
  "Should I save first or pay installments for a Rs 320,000 phone?",
  "Can I safely spend Rs 40,000 this month?",
  "Find that big purchase I made on Daraz",
  "How much should I save monthly?",
]

export function ChatWindow() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, append } = useChat(
    {
      api: "/api/chat",
      maxSteps: 6,
    },
  )
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  const errorText = error?.message ?? ""
  const errorLower = errorText.toLowerCase()
  const isRateLimit = errorLower.includes("rate limit") || errorLower.includes("429")
  const isApiKey =
    errorLower.includes("groq_api_key") || errorLower.includes("api key") || errorLower.includes("unauthorized")
  const errorTitle = isRateLimit
    ? "Rate limit reached."
    : isApiKey
      ? "Missing or invalid API key."
      : "Chat temporarily unavailable."
  const errorHint = isRateLimit
    ? "Please wait a few seconds and try again."
    : isApiKey
      ? "Set GROQ_API_KEY in .env.local and restart the dev server."
      : "Please try again in a few seconds."

  return (
    <div className="flex min-h-[65vh] flex-col sm:h-[calc(100vh-160px)]">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="card">
            <h3 className="font-medium">Hi, I&apos;m Kifayat.</h3>
            <p className="text-muted text-sm mt-1">
              Ask me about your spending, what you can afford, your risk score, or what
              you&apos;ll likely spend next month. I always cite the data I&apos;m using.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  className="btn btn-ghost text-xs"
                  onClick={() => append({ role: "user", content: q })}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user"
          // Vercel AI SDK v4: tool invocations on assistant messages
          const invocations = (m as unknown as { toolInvocations?: unknown[] })
            .toolInvocations as
            | Array<{ toolCallId?: string; toolName: string; args?: Record<string, unknown>; result?: unknown; state?: "call" | "result" | "partial-call" }>
            | undefined
          return (
            <div
              key={m.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[92%] sm:max-w-[80%] ${isUser ? "" : "w-full"}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                    isUser
                      ? "text-white"
                      : "card"
                  }`}
                  style={isUser ? { background: "var(--primary)" } : undefined}
                >
                  {m.content || (
                    <span className="text-muted italic">
                      thinking…
                    </span>
                  )}
                </div>
                {!isUser && invocations && (
                  <ToolCallTrace
                    invocations={invocations.map((i) => ({
                      toolCallId: i.toolCallId,
                      toolName: i.toolName,
                      args: i.args,
                      result: (i as { result?: unknown }).result,
                      state: i.state,
                    }))}
                  />
                )}
              </div>
            </div>
          )
        })}

        {error && (
          <div className="card text-danger text-sm">
            <strong>{errorTitle}</strong>
            <p className="mt-1 text-muted text-xs">{errorHint}</p>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 sticky bottom-0 pt-2"
        style={{ background: "var(--bg)" }}
      >
        <input
          className="input flex-1"
          placeholder={isLoading ? "Kifayat is thinking…" : "Ask about your finances…"}
          value={input}
          onChange={handleInputChange}
          disabled={isLoading}
        />
        <button className="btn btn-primary" disabled={isLoading || !input.trim()}>
          {isLoading ? "…" : "Send"}
        </button>
      </form>
    </div>
  )
}
