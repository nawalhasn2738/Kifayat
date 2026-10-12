import { ChatWindow } from "@/components/chat/ChatWindow"

export const dynamic = "force-dynamic"

export default function ChatPage() {
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-semibold">Kifayat Chat</h1>
        <p className="text-muted text-sm">
          Grounded financial assistant. All numbers come from tool calls over your real data.
        </p>
      </header>
      <ChatWindow />
    </div>
  )
}
