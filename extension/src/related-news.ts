import type { ArticleContext } from './article-context';
import { CHATGPT_MESSAGES } from './chatgpt-connection';

export interface RelatedArticle { title: string; url: string; source: string; publishedAt?: string; relationReason: string }
export interface RelatedResult { followUps: RelatedArticle[]; background: RelatedArticle[]; warnings: string[] }
export type RelatedStage = 'searching' | 'checking' | 'classifying';
export const RELATED_PROGRESS: Record<RelatedStage, string> = {
  searching: '관련 기사 검색 중…', checking: '후보 기사를 확인하는 중…', classifying: '이어지는 기사와 배경 기사를 구분하는 중…',
};
export const RELATED_MESSAGES: Record<string, string> = {
  ...CHATGPT_MESSAGES,
  CONTEXT_INSUFFICIENT: '기사 문맥이 부족합니다. 기사 페이지에서 확장 아이콘을 다시 눌러 주세요.',
  NEWS_SEARCH_NOT_CONFIGURED: '관련 뉴스 검색에는 ChatGPT plan 연결이 필요합니다.',
  NEWS_SEARCH_FAILED: '뉴스 검색에 실패했습니다. 잠시 뒤 다시 시도해 주세요.',
  NEWS_SEARCH_NETWORK_ERROR: '뉴스 검색 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  NEWS_SEARCH_INVALID_RESPONSE: '뉴스 검색 응답을 읽지 못했습니다. 다시 시도해 주세요.',
  NEWS_SEARCH_TIMEOUT: '뉴스 검색 시간이 초과됐습니다. 다시 시도해 주세요.',
  RELATED_TIMEOUT: '관련 뉴스 요청 시간이 초과됐습니다. 다시 시도해 주세요.',
  SERVER_NOT_CONFIGURED: '로컬 서버의 Easynews 확장 ID를 설정해 주세요.',
  FORBIDDEN_CLIENT: '서버에 설정한 Easynews 확장 ID를 확인해 주세요.',
  FORBIDDEN_ORIGIN: '서버에 설정한 Easynews 확장 ID를 확인해 주세요.',
  SERVER_BUSY: '다른 요청을 처리 중입니다. 잠시 뒤 다시 시도해 주세요.',
};
export const WARNING_MESSAGES: Record<string, string> = {
  FINGERPRINT_FALLBACK: 'AI 검색 특징 생성에 실패해 기사 제목으로 검색했습니다.',
  RELATION_CLASSIFICATION_FAILED: 'AI 관계 판정에 실패해 제목·시간 규칙으로 확인한 결과입니다.',
  TIME_UNKNOWN: '일부 발행 시각을 확인하지 못했습니다. 시각이 불명확한 기사는 후속 기사에서 제외합니다.',
  RULE_BASED: 'AI 관계 판정 설정이 없어 제목·시간 규칙으로 확인한 결과입니다.',
};

function validArticle(value: unknown): value is RelatedArticle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['title', 'url', 'source', 'publishedAt', 'relationReason'].includes(key))
    || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300
    || typeof row.source !== 'string' || !row.source.trim() || row.source.length > 253
    || typeof row.url !== 'string' || row.url.length > 2048
    || typeof row.relationReason !== 'string' || !row.relationReason.trim() || row.relationReason.length > 180
    || (row.publishedAt !== undefined && (typeof row.publishedAt !== 'string' || row.publishedAt.length > 80))) return false;
  try { const url = new URL(row.url); return /^https?:$/.test(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
export function validateRelatedResult(value: unknown): RelatedResult {
  const invalid = () => new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 3 || !Array.isArray(data.followUps) || data.followUps.length > 4 || !data.followUps.every(validArticle)
    || !Array.isArray(data.background) || data.background.length > 4 || !data.background.every(validArticle)
    || !Array.isArray(data.warnings) || data.warnings.length > 4 || data.warnings.some((warning) => typeof warning !== 'string' || !Object.hasOwn(WARNING_MESSAGES, warning))) throw invalid();
  return data as unknown as RelatedResult;
}
function serverFailure(value: unknown): Error {
  const error = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return new Error(typeof code === 'string' && Object.hasOwn(RELATED_MESSAGES, code) ? RELATED_MESSAGES[code] : '관련 뉴스를 가져오지 못했습니다. 다시 시도해 주세요.');
}
async function readProgress(response: Response, signal: AbortSignal, onProgress?: (stage: RelatedStage) => void): Promise<RelatedResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.');
  const decoder = new TextDecoder(); let pending = ''; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      size += chunk.value?.length || 0;
      if (size > 65_536) throw new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.');
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = pending.split('\n'); pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let value: unknown;
        try { value = JSON.parse(line); } catch { throw new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.'); }
        if (!value || typeof value !== 'object') throw new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.');
        if ('error' in value) throw serverFailure(value);
        if ('result' in value) return validateRelatedResult(value.result);
        if ('stage' in value && typeof value.stage === 'string' && Object.hasOwn(RELATED_PROGRESS, value.stage)) onProgress?.(value.stage as RelatedStage);
        else throw new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.');
      }
      if (chunk.done) throw new Error('관련 뉴스 응답이 완료되지 않았습니다. 다시 시도해 주세요.');
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function requestRelated(article: ArticleContext, signal: AbortSignal, fetcher: typeof fetch = fetch, onProgress?: (stage: RelatedStage) => void): Promise<RelatedResult> {
  if (article.confidence === 'low' || !article.textContent || article.textContent.trim().length < 80) throw new Error(RELATED_MESSAGES.CONTEXT_INSUFFICIENT);
  const response = await fetcher('http://127.0.0.1:3000/api/related', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Easynews-Extension': chrome.runtime.id, Accept: 'application/x-ndjson' }, cache: 'no-store', signal,
    body: JSON.stringify({ title: article.title.slice(0, 300), url: article.url, textContent: article.textContent.slice(0, 1200),
      ...(article.canonicalUrl ? { canonicalUrl: article.canonicalUrl } : {}),
      ...(article.siteName ? { siteName: article.siteName } : {}), ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
    }),
  });
  if (response.ok && response.headers.get('content-type')?.startsWith('application/x-ndjson')) return readProgress(response, signal, onProgress);
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('관련 뉴스 응답을 읽지 못했습니다. 다시 시도해 주세요.'); }
  if (!response.ok) {
    throw serverFailure(value);
  }
  return validateRelatedResult(value);
}
