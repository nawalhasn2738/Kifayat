import type { ChatMessage, ChatResponse } from '../chat/contract';

export type SessionMessage = ChatMessage & { id: string };
type SessionState = { messages: SessionMessage[]; loading: boolean; ready: boolean; error: string | null; retryable: boolean; mode: ChatResponse['mode'] | null };
type SessionDependencies = {
  getOrCreateConversation: () => Promise<number>;
  listMessages: (id: number) => Promise<{ id: number; role: string; content: string }[]>;
  saveMessage: (id: number, role: 'user' | 'assistant', content: string) => Promise<number>;
  chat: (messages: ChatMessage[]) => Promise<ChatResponse>;
  changed: (state: SessionState) => void;
};

export const initialChatState: SessionState = { messages: [], loading: false, ready: false, error: null, retryable: false, mode: null };

// Synchronous lock protects the interval before React publishes loading state.
export function createChatSession(dependencies: SessionDependencies) {
  let state: SessionState = { ...initialChatState, messages: [] };
  let locked = false;
  let conversationId: number | null = null;
  let pending: { content: string; userSaved: boolean; response: ChatResponse | null } | null = null;
  function publish(change: Partial<SessionState>) { state = { ...state, ...change }; dependencies.changed(state); }
  async function load() {
    if (locked || state.ready) return;
    locked = true;
    publish({ loading: true, error: null });
    try {
      conversationId = await dependencies.getOrCreateConversation();
      const saved = await dependencies.listMessages(conversationId);
      publish({ ready: true, messages: saved.filter((item) => item.role === 'user' || item.role === 'assistant')
        .map((item) => ({ id: String(item.id), role: item.role as ChatMessage['role'], content: item.content })) });
    } catch { publish({ error: 'Could not load local conversation history. Try again.' }); }
    finally { locked = false; publish({ loading: false }); }
  }
  async function completePending() {
    if (locked || !pending || !state.ready || conversationId === null) return;
    locked = true;
    publish({ loading: true, error: null, retryable: false });
    try {
      if (!pending.userSaved) {
        const id = await dependencies.saveMessage(conversationId, 'user', pending.content);
        pending.userSaved = true;
        publish({ messages: [...state.messages, { id: String(id), role: 'user', content: pending.content }] });
      }
      pending.response ??= await dependencies.chat(state.messages.map(({ role, content }) => ({ role, content })));
      const response = pending.response;
      const id = await dependencies.saveMessage(conversationId, 'assistant', response.text);
      publish({ messages: [...state.messages, { id: String(id), role: 'assistant', content: response.text }], mode: response.mode });
      pending = null;
    } catch (error) {
      // Dependency errors are deliberately generic at the persistence boundary.
      const message = error instanceof Error && /^(The AI |Could not reach|Set EXPO_PUBLIC|Local financial)/.test(error.message)
        ? error.message : 'Could not save the conversation. Try again.';
      publish({ error: message, retryable: true });
    } finally { locked = false; publish({ loading: false }); }
  }
  async function send(content: string) {
    if (locked || pending || !state.ready || !content.trim()) return;
    if (content.trim().length > 2000) { publish({ error: 'Keep questions within 2000 characters.' }); return; }
    pending = { content: content.trim(), userSaved: false, response: null };
    await completePending();
  }
  return { load, send, retry: completePending };
}
