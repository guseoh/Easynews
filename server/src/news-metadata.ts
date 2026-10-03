import { dateTime, type NewsCandidate } from './related-types.js';
import { readPublicPage } from './public-page.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function plainMetadata(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    const number = entity.match(/^&#(x[\da-f]+|\d+);$/i)?.[1];
    if (!number) return named[entity.toLowerCase()] || '';
    const code = number[0]?.toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1]!.toLowerCase()] = plainMetadata(match[2] ?? match[3] ?? match[4] ?? '');
  return result;
}
function publication(value: unknown): string | undefined {
  // A date without an explicit timezone cannot establish an ordering reliably.
  if (typeof value !== 'string' || value.length > 80 || !/\d[ T]\d{2}:\d{2}/.test(value)
    || !/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(value)) return undefined;
  const time = dateTime(value.trim());
  return time === undefined ? undefined : new Date(time).toISOString();
}

export interface NewsMetadata { title?: string; source?: string; publishedAt?: string }
export function parseNewsMetadata(html: string): NewsMetadata {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
  }
  const articles: Record<string, unknown>[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 8 || articles.length >= 20) return;
    if (Array.isArray(value)) { value.slice(0, 50).forEach((item) => walk(item, depth + 1)); return; }
    if (!object(value)) return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some((type) => typeof type === 'string' && /(?:^|\/)(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle)$/.test(type))) articles.push(value);
    // Do not read related-story lists as the current page's publication metadata.
    for (const key of ['@graph', 'mainEntity']) if (value[key]) walk(value[key], depth + 1);
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(match[1]!).type?.toLowerCase() !== 'application/ld+json') continue;
    try { walk(JSON.parse(match[2]!) as unknown); } catch { /* malformed metadata is optional */ }
  }
  const article = articles[0];
  let publishedAt = publication(article?.datePublished);
  for (const key of ['article:published_time', 'pubdate', 'publishdate', 'publish-date', 'publication_date', 'publication-date', 'datepublished', 'date', 'dc.date.issued', 'dcterms.issued', 'sailthru.date', 'parsely-pub-date']) {
    publishedAt ??= publication(meta.get(key));
  }
  if (!publishedAt) for (const match of html.matchAll(/<time\b[^>]*>/gi)) { publishedAt = publication(attributes(match[0]).datetime); if (publishedAt) break; }
  const title = plainMetadata(typeof article?.headline === 'string' ? article.headline : meta.get('og:title') || meta.get('twitter:title') || html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').slice(0, 300);
  const publisher = object(article?.publisher) ? article.publisher : undefined;
  const source = plainMetadata(meta.get('og:site_name') || (typeof publisher?.name === 'string' ? publisher.name : '')).slice(0, 120);
  return { ...(title ? { title } : {}), ...(source ? { source } : {}), ...(publishedAt ? { publishedAt } : {}) };
}

export type EnrichNews = (candidates: NewsCandidate[], signal: AbortSignal) => Promise<NewsCandidate[]>;
export function createMetadataEnricher(readPage = readPublicPage): EnrichNews {
  return async (candidates, signal) => {
    const enriched = [...candidates];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
      for (;;) {
        signal.throwIfAborted();
        const index = next++;
        const candidate = candidates[index];
        if (!candidate) return;
        let metadata: NewsMetadata = {};
        try { metadata = parseNewsMetadata(await readPage(candidate.originalUrl || candidate.url, signal)); }
        catch { signal.throwIfAborted(); /* blocked pages or missing metadata never fail the search */ }
        // Only verified page dates count; web-search snippets never supply dates.
        enriched[index] = { ...candidate, title: metadata.title || candidate.title,
          source: metadata.source || candidate.source, publishedAt: metadata.publishedAt };
      }
    }));
    return enriched;
  };
}
