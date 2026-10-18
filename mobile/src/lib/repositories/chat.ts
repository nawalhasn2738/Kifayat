import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { LOCAL_USER_ID } from '@/lib/db/seed';
import { conversations, messages } from '@/lib/db/schema';

export async function getOrCreateConversation() {
  const [existing] = await db.select().from(conversations).where(eq(conversations.userId, LOCAL_USER_ID)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(conversations).values({ userId: LOCAL_USER_ID }).returning({ id: conversations.id });
  return created.id;
}
export async function listMessages(conversationId: number) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
}
export async function saveMessage(conversationId: number, role: 'user' | 'assistant', content: string) {
  await db.insert(messages).values({ conversationId, role, content });
}
