import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { createMobileChatHandler } from '@/lib/chat/mobile-handler';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const key = process.env.GROQ_API_KEY;
  const configured = key && !key.includes('your-groq');
  return createMobileChatHandler(configured ? async ({ system, prompt, signal }) => {
    const groq = createGroq({ apiKey: key });
    const result = await generateText({ model: groq(process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'),
      system, prompt, abortSignal: signal, maxRetries: 0, maxTokens: 120, temperature: 0 });
    return result.text;
  } : undefined)(request);
}
