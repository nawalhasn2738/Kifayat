import { createGroq } from '@ai-sdk/groq';
import { generateText, type CoreMessage } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt } from '@/lib/chat/prompt';
import { buildTools, DEMO_USER_ID } from '@/lib/chat/tools';

export const runtime = 'nodejs';
export const maxDuration = 60;

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const Schema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(20),
});

export async function POST(request: Request) {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.includes('your-groq')) {
    return Response.json({ error: 'Chat requires GROQ_API_KEY on the backend.' }, { status: 503 });
  }
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid chat request.' }, { status: 400 });

  try {
    const result = await generateText({
      model: groq(process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'),
      system: await buildSystemPrompt(DEMO_USER_ID),
      messages: parsed.data.messages as CoreMessage[],
      tools: buildTools(DEMO_USER_ID),
      maxSteps: 6,
      temperature: 0.3,
    });
    return Response.json({ text: result.text });
  } catch (error) {
    console.error('[mobile-chat] generation failed', error);
    return Response.json({ error: 'Chat is temporarily unavailable.' }, { status: 502 });
  }
}
