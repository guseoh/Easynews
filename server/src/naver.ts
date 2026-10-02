import { ApiError } from './explain.js';
import { RELATED_LIMITS, safeUrl, dateTime, type NewsCandidate, type SearchNews } from './related-types.js';

export function stripNewsHtml(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', middot: '·', ndash: '–', mdash: '—' };
  return value.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? original;
    const number = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  }).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeSearchResults(value: unknown): NewsCandidate[] {
  const invalid = () => new ApiError(502, 'NEWS_SEARCH_INVALID_RESPONSE', '뉴스 검색 응답을 읽지 못했습니다.');
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items) || value.items.length > 100) throw invalid();
  return value.items.flatMap((item: unknown): NewsCandidate[] => {
    if (!item || typeof item !== 'object') throw invalid();
    const data = item as Record<string, unknown>;
    if (typeof data.title !== 'string' || data.title.length > 2000 || typeof data.link !== 'string'
      || ['originallink', 'description', 'pubDate'].some((key) => data[key] !== undefined && typeof data[key] !== 'string')) throw invalid();
    const link = safeUrl(data.link); const originalUrl = safeUrl(data.originallink);
    const title = stripNewsHtml(data.title).slice(0, RELATED_LIMITS.title);
    if (!link || !title) return [];
    const url = originalUrl || link;
    const published = typeof data.pubDate === 'string' && data.pubDate.length <= RELATED_LIMITS.publishedAt ? dateTime(data.pubDate) : undefined;
    return [{ title, url: link, ...(originalUrl ? { originalUrl } : {}),
      ...(typeof data.description === 'string' ? { description: stripNewsHtml(data.description.slice(0, 2000)).slice(0, 300) } : {}),
      ...(published !== undefined ? { publishedAt: new Date(published).toISOString() } : {}),
      source: new URL(url).hostname.replace(/^www\./, ''),
    }];
  });
}

export function createNaverSearch(config: { clientId: string; clientSecret: string; timeoutMs?: number }, fetcher: typeof fetch = fetch): SearchNews {
  return async (query, signal) => {
    if (!config.clientId || !config.clientSecret) throw new ApiError(503, 'NEWS_SEARCH_NOT_CONFIGURED', '서버의 NAVER 뉴스 검색 API 설정이 필요합니다.');
    const url = new URL('https://openapi.naver.com/v1/search/news.json');
    url.search = new URLSearchParams({ query, display: String(RELATED_LIMITS.searchDisplay), start: '1', sort: 'sim' }).toString();
    const timeout = AbortSignal.timeout(config.timeoutMs ?? 8_000);
    try {
      const response = await fetcher(url, { headers: { 'X-Naver-Client-Id': config.clientId, 'X-Naver-Client-Secret': config.clientSecret }, signal: AbortSignal.any([signal, timeout]), cache: 'no-store' });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) throw new ApiError(503, 'NEWS_SEARCH_CONFIGURATION_ERROR', 'NAVER 뉴스 검색 API 권한과 설정을 확인해 주세요.');
        throw new ApiError(502, 'NEWS_SEARCH_FAILED', '뉴스 검색에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
      }
      let value: unknown;
      try { value = await response.json(); }
      catch { throw new ApiError(502, 'NEWS_SEARCH_INVALID_RESPONSE', '뉴스 검색 응답을 읽지 못했습니다.'); }
      return normalizeSearchResults(value);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal.aborted) throw new ApiError(499, 'REQUEST_CANCELLED', '요청이 취소됐습니다.');
      if (timeout.aborted) throw new ApiError(504, 'NEWS_SEARCH_TIMEOUT', '뉴스 검색 시간이 초과됐습니다.');
      throw new ApiError(502, 'NEWS_SEARCH_NETWORK_ERROR', '뉴스 검색에 연결하지 못했습니다.');
    }
  };
}
