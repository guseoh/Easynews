import { RELATED_LIMITS, dateTime, safeUrl, type EventFingerprint, type NewsCandidate, type RelatedArticle, type RelatedInput, type RelationDecision } from './related-types.js';

export const RANKING = { keyword: 2, entity: 4, organization: 3, person: 3, event: 1, time: 2, sameSource: 0.2, nearDuplicate: 0.93, timeWindowDays: 30 } as const;
export const words = (value: string) => [...new Set((value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((word) => !['속보', '단독', '종합', '기자', '뉴스', '오늘', '관련', '대한', '이번', '위해', '통해', '있다', '한다'].includes(word)))];
const titleKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');

export function canonicalizeUrl(value: string): string {
  if (!safeUrl(value)) return '';
  const url = new URL(value);
  // NAVER desktop/mobile forms identify the same article by oid/aid.
  const article = url.pathname.match(/^\/(?:mnews\/)?article\/(\d+)\/(\d+)/);
  if (/(^|\.)news\.naver\.com$/.test(url.hostname)) {
    const oid = article?.[1] || url.searchParams.get('oid');
    const aid = article?.[2] || url.searchParams.get('aid');
    if (oid && aid && /^\d+$/.test(oid) && /^\d+$/.test(aid)) return `https://n.news.naver.com/article/${oid}/${aid}`;
  }
  url.hash = '';
  url.hostname = url.hostname.replace(/^www\./, '');
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|ref|referrer|from|cds|sid|nclick|lfrom|tracking)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}

export function titleSimilarity(left: string, right: string): number {
  const a = titleKey(left); const b = titleKey(right);
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 12) return 0;
  const grams = (text: string) => new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
  const aa = grams(a); const bb = grams(b);
  return 2 * [...aa].filter((gram) => bb.has(gram)).length / (aa.size + bb.size);
}

export function deduplicate(candidates: NewsCandidate[], current: RelatedInput): NewsCandidate[] {
  const urls = new Set([current.url, current.canonicalUrl].filter((value): value is string => !!value).map(canonicalizeUrl));
  const kept: NewsCandidate[] = [];
  for (const candidate of candidates) {
    const aliases = [candidate.url, candidate.originalUrl].filter((value): value is string => !!value).map(canonicalizeUrl);
    if (aliases.some((url) => urls.has(url)) || titleSimilarity(candidate.title, current.title) >= RANKING.nearDuplicate
      || kept.some((previous) => titleSimilarity(previous.title, candidate.title) >= RANKING.nearDuplicate)) {
      // Keep aliases of skipped copies, so a portal copy cannot re-enter later.
      aliases.forEach((url) => urls.add(url));
      continue;
    }
    aliases.forEach((url) => urls.add(url));
    kept.push(candidate);
  }
  return kept;
}

export function fallbackFingerprint(input: RelatedInput): EventFingerprint {
  const tokens = words(input.title).map((word) => word.slice(0, 60)).slice(0, 8);
  const text = `${input.title} ${input.textContent}`;
  const organizations = [...new Set(words(text).filter((word) => /(?:은행|위원회|정부|공사|전자|그룹|연구원|연구소|협회)$/.test(word)))].slice(0, 8);
  const people = [...new Set([...text.matchAll(/([가-힣]{2,4})\s+(?:총재|대통령|장관|대표|의원|감독|교수)/g)].map((match) => match[1]!))].slice(0, 8);
  const locations = [...new Set([...text.matchAll(/(?:서울|부산|대구|인천|대한민국|미국|중국|일본|유럽)/g)].map((match) => match[0]))].slice(0, 8);
  const entities = [...new Set([...organizations, ...people, ...(!organizations.length && !people.length ? tokens.slice(0, 1) : [])])].slice(0, 8);
  const base = (tokens.slice(0, 6).join(' ') || input.title).slice(0, 90);
  return { event: input.title.slice(0, 200), entities, organizations, people, locations, keywords: tokens.length ? tokens : [input.title.slice(0, 60)],
    searchQueries: [...new Set([base, `${base} 후속`.slice(0, 100), `${base} 배경`.slice(0, 100)])] };
}

const hits = (title: string, values: string[]) => values.filter((value) => title.includes(value.toLowerCase())).length;
export function rankCandidates(candidates: NewsCandidate[], fingerprint: EventFingerprint, input: RelatedInput): NewsCandidate[] {
  const now = dateTime(input.publishedAt);
  return candidates.map((candidate) => {
    const title = candidate.title.normalize('NFKC').toLowerCase();
    const keyword = hits(title, fingerprint.keywords);
    const entity = hits(title, fingerprint.entities);
    const organization = hits(title, fingerprint.organizations);
    const person = hits(title, fingerprint.people);
    const subjects = [...fingerprint.entities, ...fingerprint.organizations, ...fingerprint.people].map((value) => value.toLowerCase());
    const topical = hits(title, fingerprint.keywords.filter((value) => !subjects.includes(value.toLowerCase())));
    const published = dateTime(candidate.publishedAt);
    const proximity = now !== undefined && published !== undefined ? Math.max(0, 1 - Math.abs(now - published) / (RANKING.timeWindowDays * 86_400_000)) : 0;
    const score = keyword * RANKING.keyword + entity * RANKING.entity + organization * RANKING.organization + person * RANKING.person
      + hits(title, words(fingerprint.event)) * RANKING.event + proximity * RANKING.time + (candidate.source === input.siteName ? RANKING.sameSource : 0);
    return { candidate, score, relevant: topical >= 1 && (keyword >= 2 || entity >= 1 && keyword >= 1) };
  }).filter((row) => row.relevant).sort((a, b) => b.score - a.score || a.candidate.url.localeCompare(b.candidate.url)).slice(0, RELATED_LIMITS.shortlist).map((row) => row.candidate);
}

export function fallbackRelations(input: RelatedInput, candidates: NewsCandidate[]): RelationDecision[] {
  const currentTime = dateTime(input.publishedAt);
  return candidates.map((candidate, index) => {
    const published = dateTime(candidate.publishedAt);
    const newer = currentTime !== undefined && published !== undefined && published > currentTime;
    const follow = /후속|이후|반응|기자회견|추가|착수|결과|전망|발표|계획/.test(candidate.title);
    const background = /배경|원인|이전|지난|지표|물가|대출|환율|경위|역사|논란|과정/.test(candidate.title);
    const relation = newer && follow ? 'follow_up' : !newer && background ? 'background' : 'related';
    return { index, relation, relationReason: relation === 'follow_up' ? '현재 기사 이후 같은 사건의 반응이나 진행 상황을 다룬 보도입니다.'
      : relation === 'background' ? '현재 사건의 이전 상황이나 배경을 살펴볼 수 있는 보도입니다.' : '같은 사건의 검색 후보입니다. 직접적인 후속·배경 관계는 확인되지 않았습니다.' };
  });
}

export function enforceTime(input: RelatedInput, candidate: NewsCandidate, decision: RelationDecision): RelationDecision {
  const current = dateTime(input.publishedAt); const published = dateTime(candidate.publishedAt);
  if (decision.relation === 'follow_up' && (current === undefined || published === undefined || published <= current)) {
    return { ...decision, relation: 'related', relationReason: '후속 기사로 확인할 수 없는 검색 후보입니다.' };
  }
  if (decision.relation === 'background' && current !== undefined && published !== undefined && published > current) {
    return { ...decision, relation: 'related', relationReason: '현재 기사 이후에 발행된 검색 후보입니다.' };
  }
  if (decision.relation === 'background' && (current === undefined || published === undefined)) {
    return { ...decision, relationReason: `발행 시각 미확인 · ${decision.relationReason}`.slice(0, RELATED_LIMITS.reason) };
  }
  return decision;
}

export function sourceDiversity(items: RelatedArticle[], limit: number = RELATED_LIMITS.perGroup, perSource: number = RELATED_LIMITS.perSource): RelatedArticle[] {
  const counts = new Map<string, number>();
  const selected: RelatedArticle[] = [];
  for (const item of items) {
    const source = item.source.trim().toLowerCase();
    const count = counts.get(source) || 0;
    if (count >= perSource) continue;
    selected.push(item); counts.set(source, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}
