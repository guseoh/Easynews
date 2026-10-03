import { sourceDiversity } from './news-ranking.js';
import { dateTime, RELATED_LIMITS, type RelatedArticle } from './related-types.js';

export interface ClassifiedArticle { index: number; relation: 'follow_up' | 'background'; article: RelatedArticle; duplicateOf?: number }

// Group only verified relations after temporal validation; a shared topic is insufficient.
export function groupNews(rows: ClassifiedArticle[]) {
  const groups = new Map<number, ClassifiedArticle>();
  const roots = new Map<number, number>();
  for (const row of [...rows].sort((a, b) => a.index - b.index)) {
    const root = row.duplicateOf === undefined ? undefined : roots.get(row.duplicateOf);
    const previous = root === undefined ? undefined : groups.get(root);
    const time = dateTime(row.article.publishedAt); const priorTime = dateTime(previous?.article.publishedAt);
    if (previous && previous.relation === row.relation && time !== undefined && priorTime !== undefined && Math.abs(time - priorTime) <= 86_400_000) {
      const alternatives = previous.article.alternatives ||= [];
      if (alternatives.length < 3) {
        const { relationReason: _reason, alternatives: _alternatives, ...link } = row.article;
        alternatives.push(link);
      }
      roots.set(row.index, previous.index);
    } else {
      groups.set(row.index, { ...row, article: { ...row.article } }); roots.set(row.index, row.index);
    }
  }
  const select = (relation: ClassifiedArticle['relation']) => {
    const articles = sourceDiversity([...groups.values()].filter((row) => row.relation === relation).map((row) => row.article));
    const counts = new Map<string, number>();
    const key = (source: string) => source.trim().toLowerCase();
    for (const article of articles) counts.set(key(article.source), (counts.get(key(article.source)) || 0) + 1);
    for (const article of articles) {
      const alternatives = article.alternatives?.filter((link) => {
        const source = key(link.source); const count = counts.get(source) || 0;
        if (count >= RELATED_LIMITS.perSource) return false;
        counts.set(source, count + 1); return true;
      });
      if (alternatives?.length) article.alternatives = alternatives;
      else delete article.alternatives;
    }
    return articles;
  };
  return { followUps: select('follow_up'), background: select('background') };
}
