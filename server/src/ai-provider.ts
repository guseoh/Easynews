import { createExplainer, type Explain, type LlmConfig } from './openai.js';
import { createRelatedLlm } from './related-llm.js';
import type { RelatedLlm } from './related-types.js';

export type AiProviderId = 'api-key' | 'chatgpt-plan';
export const DEFAULT_AI_PROVIDER: AiProviderId = 'chatgpt-plan';
export interface AiProvider {
  readonly id: AiProviderId;
  readonly explain: Explain;
  readonly relatedLlm?: RelatedLlm;
}

export class OpenAIApiKeyProvider implements AiProvider {
  readonly id = 'api-key';
  readonly explain: Explain;
  readonly relatedLlm?: RelatedLlm;
  constructor(config: LlmConfig, fetcher: typeof fetch = fetch) {
    this.explain = createExplainer(config, fetcher);
    this.relatedLlm = config.apiKey ? createRelatedLlm(config, fetcher) : undefined;
  }
}

export function selectAiProvider(value: string | undefined, apiKey: AiProvider, chatgptPlan?: AiProvider): AiProvider {
  const id = value?.trim() || DEFAULT_AI_PROVIDER;
  if (id === 'api-key') return apiKey;
  if (id === 'chatgpt-plan' && chatgptPlan) return chatgptPlan;
  throw new Error('AI_PROVIDER must be api-key or an available chatgpt-plan provider.');
}
