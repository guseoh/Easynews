import { ApiError } from './explain.js';

export const RELATED_LIMITS = { title: 300, url: 2_048, siteName: 120, publishedAt: 80, textContent: 1_200, reason: 180, queries: 3, searchDisplay: 20, shortlist: 12, perGroup: 4, perSource: 2 } as const;
export interface RelatedInput { title: string; url: string; canonicalUrl?: string; siteName?: string; publishedAt?: string; textContent: string }
export interface EventFingerprint { event: string; entities: string[]; organizations: string[]; people: string[]; locations: string[]; keywords: string[]; searchQueries: string[] }
export interface NewsCandidate { title: string; url: string; originalUrl?: string; description?: string; publishedAt?: string; source: string }
export type Relation = 'follow_up' | 'background' | 'related' | 'irrelevant';
export interface RelationDecision { index: number; relation: Relation; relationReason: string }
export interface RelatedArticle { title: string; url: string; source: string; publishedAt?: string; relationReason: string }
export type RelatedWarning = 'FINGERPRINT_FALLBACK' | 'RELATION_CLASSIFICATION_FAILED' | 'TIME_UNKNOWN' | 'RULE_BASED';
export interface RelatedResult { followUps: RelatedArticle[]; background: RelatedArticle[]; warnings: RelatedWarning[] }
export type Related = (input: RelatedInput, signal: AbortSignal) => Promise<RelatedResult>;
export type SearchNews = (query: string, signal: AbortSignal) => Promise<NewsCandidate[]>;
export interface RelatedLlm {
  fingerprint(input: RelatedInput, signal: AbortSignal): Promise<EventFingerprint>;
  classify(input: RelatedInput, fingerprint: EventFingerprint, candidates: NewsCandidate[], signal: AbortSignal): Promise<RelationDecision[]>;
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > RELATED_LIMITS.url) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function dateTime(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  // A calendar date alone cannot establish which article came first that day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) {
    const calendar = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (calendar.getUTCMonth() !== Number(iso[2]) - 1 || calendar.getUTCDate() !== Number(iso[3])) return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function validateRelatedInput(value: unknown): RelatedInput {
  const fail = () => new ApiError(400, 'INVALID_RELATED_INPUT', '관련 뉴스를 찾을 기사 정보를 확인해 주세요.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const data = value as Record<string, unknown>;
  const fields = ['title', 'url', 'canonicalUrl', 'siteName', 'publishedAt', 'textContent'];
  if (Object.keys(data).some((key) => !fields.includes(key)) || typeof data.title !== 'string'
    || !safeUrl(data.url) || typeof data.textContent !== 'string') throw fail();
  for (const [key, limit] of Object.entries(RELATED_LIMITS)) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || (data[key] as string).length > limit)) throw fail();
  }
  if (data.canonicalUrl !== undefined && !safeUrl(data.canonicalUrl)) throw fail();
  if (data.title.trim().length < 3 || data.textContent.trim().length < 80) {
    throw new ApiError(422, 'CONTEXT_INSUFFICIENT', '기사 문맥이 부족합니다. 기사 페이지에서 확장 아이콘을 다시 눌러 주세요.');
  }
  return { title: data.title.trim(), url: safeUrl(data.url)!, textContent: data.textContent.trim(),
    ...(data.canonicalUrl ? { canonicalUrl: safeUrl(data.canonicalUrl)! } : {}),
    ...(data.siteName ? { siteName: (data.siteName as string).trim() } : {}),
    ...(data.publishedAt ? { publishedAt: (data.publishedAt as string).trim() } : {}),
  };
}

export function validateFingerprint(value: unknown): EventFingerprint {
  const fail = () => new ApiError(502, 'INVALID_FINGERPRINT', '검색 특징을 생성하지 못했습니다.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const data = value as Record<string, unknown>;
  const lists = ['entities', 'organizations', 'people', 'locations', 'keywords', 'searchQueries'] as const;
  if (Object.keys(data).length !== 7 || typeof data.event !== 'string' || !data.event.trim() || data.event.length > 200) throw fail();
  for (const key of lists) {
    const list = data[key];
    const max = key === 'searchQueries' ? RELATED_LIMITS.queries : 8;
    if (!Array.isArray(list) || list.length > max || (key === 'searchQueries' || key === 'keywords') && !list.length
      || list.some((item) => typeof item !== 'string' || !item.trim() || item.length > (key === 'searchQueries' ? 100 : 60))) throw fail();
  }
  return { event: data.event.trim(), ...Object.fromEntries(lists.map((key) => [key, [...new Set((data[key] as string[]).map((item) => item.trim()))]])) } as unknown as EventFingerprint;
}

export function validateRelations(value: unknown, count: number): RelationDecision[] {
  const fail = () => new ApiError(502, 'RELATION_CLASSIFICATION_FAILED', '기사 관계를 판정하지 못했습니다.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Array.isArray(data.relations) || data.relations.length !== count) throw fail();
  const seen = new Set<number>();
  return data.relations.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw fail();
    const row = item as Record<string, unknown>;
    if (Object.keys(row).length !== 3 || !Number.isInteger(row.index) || (row.index as number) < 0 || (row.index as number) >= count
      || seen.has(row.index as number) || !['follow_up', 'background', 'related', 'irrelevant'].includes(row.relation as string)
      || typeof row.relationReason !== 'string' || !row.relationReason.trim() || row.relationReason.length > RELATED_LIMITS.reason
      || /[<>\r\n]/.test(row.relationReason)) throw fail();
    seen.add(row.index as number);
    return { index: row.index as number, relation: row.relation as Relation, relationReason: row.relationReason.trim() };
  });
}
