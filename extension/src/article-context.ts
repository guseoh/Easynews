import { Readability } from '@mozilla/readability';

export const CONTEXT_LIMITS = { title: 300, url: 2_048, siteName: 120, byline: 120, publishedAt: 80, textContent: 1_200, surroundingContext: 1_600 } as const;
export interface ArticleContext {
  title: string;
  url: string;
  canonicalUrl?: string;
  siteName?: string;
  byline?: string;
  publishedAt?: string;
  // Only a bounded lead excerpt, never the full extracted article.
  textContent?: string;
  surroundingContext?: string;
  extractionMethod: 'readability' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
}
type ParsedArticle = ReturnType<Readability['parse']>;
type ParseArticle = (clone: Document) => ParsedArticle;
export const cleanText = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
const limited = (value: string | null | undefined, size: number) => cleanText(value).slice(0, size) || undefined;

export function httpUrl(value: string | null | undefined, base?: string): string | undefined {
  try {
    const url = new URL(value || '', base);
    return value && /^https?:$/.test(url.protocol) && !url.username && !url.password && url.href.length <= CONTEXT_LIMITS.url ? url.href : undefined;
  } catch { return undefined; }
}

export function surroundingParagraphs(paragraphs: string[], selectedText: string, limit = CONTEXT_LIMITS.surroundingContext): string {
  const selection = cleanText(selectedText);
  if (!selection || !paragraphs.length) return '';
  const normalized = paragraphs.map(cleanText);
  const index = normalized.findIndex((paragraph) => paragraph.includes(selection));
  if (index < 0) return '';
  const paragraph = normalized[index]!;
  // Center a long paragraph around the selection rather than truncating its start.
  const start = Math.max(0, paragraph.indexOf(selection) - Math.floor(Math.max(0, limit - selection.length) / 2));
  let result = paragraph.slice(start, start + limit);
  const before = normalized[index - 1];
  const after = normalized[index + 1];
  // Prioritize the selected paragraph, then share remaining space with neighbors.
  const remaining = Math.max(0, limit - result.length - 2);
  const beforeSize = before ? Math.min(before.length, after ? Math.floor(remaining / 2) : remaining) : 0;
  const afterSize = after ? Math.min(after.length, remaining - beforeSize) : 0;
  if (beforeSize) result = `${before!.slice(-beforeSize)}\n${result}`;
  if (afterSize) result += `\n${after!.slice(0, afterSize)}`;
  return result.slice(0, limit);
}

export function selectionContext(doc: Document, selectedText: string, selection?: Selection | null): string {
  const anchor = selection?.anchorNode?.parentElement;
  if (anchor?.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), nav, footer, aside')) return '';
  const paragraph = anchor?.closest('p');
  const root = paragraph?.closest('article, [role="article"], main') || doc.querySelector('article, [role="article"], main');
  if (!root) return '';
  const paragraphs = Array.from(root.querySelectorAll('p')).filter((node) => !node.closest('nav, footer, aside, [contenteditable]:not([contenteditable="false"])'));
  // Prefer the selected DOM paragraph when an article repeats the same phrase.
  if (paragraph && paragraphs.includes(paragraph)) {
    const index = paragraphs.indexOf(paragraph);
    return surroundingParagraphs(paragraphs.slice(Math.max(0, index - 1), index + 2).map((node) => node.textContent || ''), selectedText);
  }
  return surroundingParagraphs(paragraphs.map((node) => node.textContent || ''), selectedText);
}

export function extractArticleContext(doc: Document, url: string, parse: ParseArticle = (clone) => new Readability(clone, { maxElemsToParse: 20_000 }).parse()): ArticleContext {
  const meta = (selector: string) => doc.querySelector<HTMLMetaElement>(selector)?.content;
  const title = limited(meta('meta[property="og:title"]') || doc.title, CONTEXT_LIMITS.title) || '현재 페이지';
  const canonicalUrl = httpUrl(doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href'), url);
  const siteName = limited(meta('meta[property="og:site_name"]'), CONTEXT_LIMITS.siteName);
  const byline = limited(meta('meta[name="author"]'), CONTEXT_LIMITS.byline);
  const publishedAt = limited(meta('meta[property="article:published_time"]') || doc.querySelector('time[datetime]')?.getAttribute('datetime'), CONTEXT_LIMITS.publishedAt);
  const articleRoot = doc.querySelector('article, [role="article"]');
  const newsHint = meta('meta[property="og:type"]') === 'article' || !!publishedAt;
  let parsed: ParsedArticle = null;
  try { parsed = parse(doc.cloneNode(true) as Document); } catch { /* Metadata remains available. */ }
  const readableText = cleanText(parsed?.textContent);
  const fallbackText = articleRoot ? cleanText(Array.from(articleRoot.querySelectorAll('p')).filter((node) => !node.closest('nav, footer, aside, [contenteditable]')).map((node) => node.textContent).join('\n')) : '';
  const text = readableText.length >= 200 ? readableText : fallbackText;
  // Readability can parse non-news pages; prose alone is not a news signal.
  const confidence = text.length >= 200 && newsHint ? (readableText.length >= 200 ? 'high' : 'medium') : 'low';
  return {
    title: limited(parsed?.title, CONTEXT_LIMITS.title) || title,
    url,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(limited(parsed?.siteName, CONTEXT_LIMITS.siteName) || siteName ? { siteName: limited(parsed?.siteName, CONTEXT_LIMITS.siteName) || siteName } : {}),
    ...(limited(parsed?.byline, CONTEXT_LIMITS.byline) || byline ? { byline: limited(parsed?.byline, CONTEXT_LIMITS.byline) || byline } : {}),
    ...(limited(parsed?.publishedTime, CONTEXT_LIMITS.publishedAt) || publishedAt ? { publishedAt: limited(parsed?.publishedTime, CONTEXT_LIMITS.publishedAt) || publishedAt } : {}),
    ...(confidence !== 'low' ? { textContent: text.slice(0, CONTEXT_LIMITS.textContent) } : {}),
    extractionMethod: readableText.length >= 200 ? 'readability' : 'fallback', confidence,
  };
}

export function isArticleContext(value: unknown, pageUrl: string): value is ArticleContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return Object.keys(context).every((key) => ['extractionMethod', 'confidence', ...Object.keys(CONTEXT_LIMITS), 'canonicalUrl'].includes(key))
    && typeof context.title === 'string' && context.title.length <= CONTEXT_LIMITS.title
    && context.url === pageUrl && !!httpUrl(pageUrl)
    && ['readability', 'fallback'].includes(context.extractionMethod as string)
    && ['high', 'medium', 'low'].includes(context.confidence as string)
    && (context.canonicalUrl === undefined || typeof context.canonicalUrl === 'string' && !!httpUrl(context.canonicalUrl))
    && Object.entries(CONTEXT_LIMITS).every(([key, size]) => context[key] === undefined || typeof context[key] === 'string' && (context[key] as string).length <= size);
}
