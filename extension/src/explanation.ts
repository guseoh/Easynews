export const MAX_EXPLAIN_SELECTION = 2_000;
export const MAX_EXPLAIN_TITLE = 300;
export const MAX_EXPLAIN_ANSWER = 8_000;
export type ExplainMode = 'simple' | 'why' | 'background';
export interface ExplainSelection { title: string; selectedText: string }

export async function requestExplanation(
  mode: ExplainMode, selection: ExplainSelection, signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!selection.selectedText.trim() || selection.selectedText.length > MAX_EXPLAIN_SELECTION) {
    throw new Error('설명할 문장을 1~2,000자 선택해 주세요.');
  }
  const response = await fetcher('http://127.0.0.1:3000/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Easynews-Extension': chrome.runtime.id },
    body: JSON.stringify({ mode, selectedText: selection.selectedText, articleTitle: selection.title.slice(0, MAX_EXPLAIN_TITLE) }),
    cache: 'no-store', signal,
  });
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error('서버 응답을 읽지 못했습니다. 다시 시도해 주세요.'); }
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'error' in value
      && value.error && typeof value.error === 'object' && 'code' in value.error ? value.error.code : '';
    // Use our own messages; never display arbitrary upstream or server error text.
    const messages: Record<string, string> = {
      SERVER_NOT_CONFIGURED: '로컬 서버의 API 키와 확장 ID를 설정해 주세요.',
      LLM_CONFIGURATION_ERROR: '서버의 API 키와 모델 접근 권한을 확인해 주세요.',
      FORBIDDEN_CLIENT: '서버에 설정한 Easynews 확장 ID를 확인해 주세요.',
      FORBIDDEN_ORIGIN: '서버에 설정한 Easynews 확장 ID를 확인해 주세요.',
      LLM_RATE_LIMIT: 'AI 요청 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.',
      SERVER_BUSY: '다른 설명을 처리 중입니다. 잠시 뒤 다시 시도해 주세요.',
      LLM_TIMEOUT: 'AI 응답 시간이 초과됐습니다. 다시 시도해 주세요.',
      EXPLANATION_UNAVAILABLE: '이 문장에 대한 설명을 제공하지 못했습니다. 다른 문장을 선택해 주세요.',
    };
    throw new Error(typeof code === 'string' ? messages[code] || '설명을 가져오지 못했습니다. 다시 시도해 주세요.' : '설명을 가져오지 못했습니다.');
  }
  if (!value || typeof value !== 'object' || !('answer' in value)
    || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > MAX_EXPLAIN_ANSWER) {
    throw new Error('AI 응답을 읽지 못했습니다. 다시 시도해 주세요.');
  }
  return value.answer;
}

// All request/answer state stays in the panel. An invalidation also defeats fetchers
// that resolve after abort, preventing an answer for a previous article from appearing.
export class ExplanationSession {
  private generation = 0;
  private controller?: AbortController;
  invalidate() { this.generation++; this.controller?.abort(); this.controller = undefined; }
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    this.invalidate();
    const generation = this.generation;
    this.controller = new AbortController();
    try {
      const result = await work(this.controller.signal);
      return generation === this.generation ? result : undefined;
    } catch (error) {
      if (generation !== this.generation) return undefined;
      throw error;
    } finally {
      if (generation === this.generation) this.controller = undefined;
    }
  }
}
