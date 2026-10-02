import { ApiError, createPrompt, parseAnswer, type ExplainInput } from './explain.js';

export interface LlmConfig { apiKey: string; model: string; timeoutMs?: number }
export type Explain = (input: ExplainInput, signal: AbortSignal) => Promise<string>;

export function createExplainer(config: LlmConfig, fetcher: typeof fetch = fetch): Explain {
  return async (input, signal) => {
    if (!config.apiKey) throw new ApiError(503, 'SERVER_NOT_CONFIGURED', '로컬 서버의 API 키를 설정해 주세요.');
    const timeout = AbortSignal.timeout(config.timeoutMs ?? 30_000);
    try {
      const response = await fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, ...createPrompt(input), store: false, max_output_tokens: 1_200 }),
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new ApiError(429, 'LLM_RATE_LIMIT', 'AI 요청 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.');
        if (response.status === 401 || response.status === 403) throw new ApiError(503, 'LLM_CONFIGURATION_ERROR', '서버의 API 키와 모델 접근 권한을 확인해 주세요.');
        throw new ApiError(502, 'LLM_FAILED', 'AI 서비스에 연결하지 못했습니다. 다시 시도해 주세요.');
      }
      return parseAnswer(await response.json());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal.aborted) throw new ApiError(499, 'REQUEST_CANCELLED', '요청이 취소됐습니다.');
      if (timeout.aborted) throw new ApiError(504, 'LLM_TIMEOUT', 'AI 응답 시간이 초과됐습니다. 다시 시도해 주세요.');
      throw new ApiError(502, 'LLM_FAILED', 'AI 서비스에 연결하지 못했습니다. 다시 시도해 주세요.');
    }
  };
}
