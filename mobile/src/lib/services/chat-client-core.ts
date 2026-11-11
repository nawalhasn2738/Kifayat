import { buildAnswerPlan, parseChatRequest, parseChatResponse, recentMessages, renderAnswer,
  type ChatMessage, type ChatRequest, type ChatResponse, type FinancialContext } from '../chat/contract';

export type ChatClientDependencies = {
  endpoint: string;
  getContext: () => Promise<FinancialContext>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export function createChatClient(dependencies: ChatClientDependencies) {
  return async function chat(messages: ChatMessage[]): Promise<ChatResponse> {
    let request: ChatRequest;
    try { request = parseChatRequest({ version: 1, messages: recentMessages(messages), context: await dependencies.getContext() }); }
    catch { throw new Error('Local financial data could not be read safely. Check Financial Planning and try again.'); }
    // No configuration still permits a fully local, deterministic answer without disclosing data.
    if (!dependencies.endpoint) return { version: 1, text: renderAnswer(buildAnswerPlan(request)), source: 'mobile_sqlite',
      mode: 'deterministic', asOf: request.context.asOf };
    try {
      const url = new URL(dependencies.endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid endpoint.');
    } catch { throw new Error('Set EXPO_PUBLIC_AI_PROXY_URL to the full trusted HTTPS /api/mobile-chat endpoint.'); }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await dependencies.fetch(dependencies.endpoint, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal, redirect: 'error' });
          if (!response.ok) throw new Error('The AI service is unavailable. Try again.');
          try { return parseChatResponse(await response.json(), request); }
          catch { throw new Error('The AI service returned an unsupported answer. Try again.'); }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('The AI request timed out. Try again.')); }, dependencies.timeoutMs ?? 25_000); }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('The AI ')) throw error;
      throw new Error('Could not reach the AI service. Check your connection and try again.');
    } finally { if (timer) clearTimeout(timer); }
  };
}
