import { ApiError, MAX_ANSWER_LENGTH, parseAnswer } from './explain.js';

// Only the bounded answer crosses the local stream; provider metadata and errors do not.
export async function readExplanationStream(response: Response, signal: AbortSignal, onDelta: (delta: string) => void): Promise<string> {
  const invalid = () => new ApiError(502, 'INVALID_LLM_RESPONSE', 'AI 응답을 읽지 못했습니다. 다시 시도해 주세요.');
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const decoder = new TextDecoder();
  let pending = ''; let bytes = 0; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      bytes += chunk.value?.length || 0;
      if (bytes > 1_048_576) throw invalid();
      pending = (pending + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const block = pending.slice(0, end); pending = pending.slice(end + 2);
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(data); } catch { throw invalid(); }
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw invalid();
        if (event.type === 'response.output_text.delta') {
          if (typeof event.delta !== 'string') throw invalid();
          length += event.delta.length;
          if (length > MAX_ANSWER_LENGTH) throw invalid();
          onDelta(event.delta);
        }
        if (event.type === 'response.completed') return parseAnswer(event.response);
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type as string)) throw invalid();
      }
      if (pending.length > 65_536 || chunk.done) throw invalid();
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
