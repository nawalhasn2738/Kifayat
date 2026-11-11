import { db } from '@/lib/db/client';
import { createChatRepository } from '@/lib/repositories/chat-core';

const chatRepository = createChatRepository(db);

export const { getOrCreateConversation, listMessages, saveMessage } = chatRepository;
