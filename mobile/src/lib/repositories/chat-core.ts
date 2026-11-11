import { asc, eq } from 'drizzle-orm';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { conversations, messages } from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db/types';

export type ChatRepositoryDependencies = {
  userId: number;
};

export function createChatRepository<TRunResult>(
  database: AppDatabase<TRunResult>,
  dependencies: ChatRepositoryDependencies = { userId: LOCAL_USER_ID },
) {
  async function getOrCreateConversation() {
    const [existing] = await database.select().from(conversations)
      .where(eq(conversations.userId, dependencies.userId)).limit(1);
    if (existing) return existing.id;
    const [created] = await database.insert(conversations)
      .values({ userId: dependencies.userId }).returning({ id: conversations.id });
    return created.id;
  }

  async function listMessages(conversationId: number) {
    await requireOwnedConversation(conversationId);
    return database.select().from(messages)
      .where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt), asc(messages.id));
  }

  async function saveMessage(conversationId: number, role: 'user' | 'assistant', content: string) {
    await requireOwnedConversation(conversationId);
    const [saved] = await database.insert(messages).values({ conversationId, role, content }).returning({ id: messages.id });
    return saved.id;
  }

  async function requireOwnedConversation(conversationId: number) {
    const [conversation] = await database.select({ userId: conversations.userId }).from(conversations)
      .where(eq(conversations.id, conversationId)).limit(1);
    if (!conversation || conversation.userId !== dependencies.userId) throw new Error('Conversation unavailable.');
  }

  return { getOrCreateConversation, listMessages, saveMessage };
}
