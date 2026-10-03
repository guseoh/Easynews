import { deduplicate, enforceTime, fallbackFingerprint, fallbackRelations, rankCandidates } from './news-ranking.js';
import { groupNews, type ClassifiedArticle } from './news-grouping.js';
import { ApiError } from './explain.js';
import type { EnrichNews } from './news-metadata.js';
import { RELATED_LIMITS, dateTime, validateFingerprint, validateRelations, type Related, type RelatedArticle, type RelatedLlm, type RelatedWarning, type SearchNews } from './related-types.js';

export function createRelatedService(search: SearchNews, llm?: RelatedLlm, options: { combinedSearch?: boolean; enrich?: EnrichNews } = {}): Related {
  return async (input, signal, onProgress) => {
    // No cache or history: all features, candidates and decisions live in this request.
    const child = new AbortController();
    const requestSignal = AbortSignal.any([signal, child.signal]);
    const warnings: RelatedWarning[] = [];
    try {
      requestSignal.throwIfAborted();
      onProgress?.('searching');
      let fingerprint = fallbackFingerprint(input);
      if (llm) {
        try { fingerprint = validateFingerprint(await llm.fingerprint(input, requestSignal)); }
        catch (error) { requestSignal.throwIfAborted(); if (error instanceof ApiError && error.code.startsWith('CHATGPT_') && error.code !== 'CHATGPT_FAILED') throw error; warnings.push('FINGERPRINT_FALLBACK'); }
      } else warnings.push('RULE_BASED');
      // The existing query interface remains intact. Hosted search receives all
      // event metadata once, rather than three expensive parallel plan requests.
      const queries = options.combinedSearch ? [JSON.stringify({ title: input.title, event: fingerprint.event,
        entities: fingerprint.entities, organizations: fingerprint.organizations, people: fingerprint.people,
        keywords: fingerprint.keywords, queries: fingerprint.searchQueries, publishedAt: input.publishedAt })]
        : [...new Set(fingerprint.searchQueries)].slice(0, RELATED_LIMITS.queries);
      const batches = await Promise.all(queries.map((query) => search(query, requestSignal)));
      requestSignal.throwIfAborted();
      onProgress?.('checking');
      let candidates = rankCandidates(deduplicate(batches.flat(), input), fingerprint, input);
      if (options.enrich && candidates.length) {
        candidates = rankCandidates(deduplicate(await options.enrich(candidates, requestSignal), input), fingerprint, input);
      }
      requestSignal.throwIfAborted();
      onProgress?.('classifying');
      let decisions = fallbackRelations(input, candidates);
      if (llm && candidates.length) {
        try { decisions = validateRelations({ relations: await llm.classify(input, fingerprint, candidates, requestSignal) }, candidates.length); }
        catch (error) { requestSignal.throwIfAborted(); if (error instanceof ApiError && error.code.startsWith('CHATGPT_') && error.code !== 'CHATGPT_FAILED') throw error; warnings.push('RELATION_CLASSIFICATION_FAILED'); }
      }
      requestSignal.throwIfAborted();
      const rows: ClassifiedArticle[] = [];
      let dateBlocked = false;
      if (dateTime(input.publishedAt) === undefined || candidates.some((candidate) => dateTime(candidate.publishedAt) === undefined)) warnings.push('TIME_UNKNOWN');
      for (const decision of decisions.sort((a, b) => a.index - b.index)) {
        const candidate = candidates[decision.index]!;
        const checked = enforceTime(input, candidate, decision);
        if (decision.relation === 'follow_up' && checked.relation !== 'follow_up'
          && (dateTime(input.publishedAt) === undefined || dateTime(candidate.publishedAt) === undefined)) dateBlocked = true;
        if (checked.relation !== 'follow_up' && checked.relation !== 'background') continue;
        const article: RelatedArticle = { title: candidate.title, url: candidate.originalUrl || candidate.url, source: candidate.source,
          ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}), relationReason: checked.relationReason };
        rows.push({ index: decision.index, relation: checked.relation, article,
          ...(decision.duplicateOf !== undefined ? { duplicateOf: decision.duplicateOf } : {}) });
      }
      // Dates constrain relation labels; the source limit never fills gaps with weak matches.
      const result = { ...groupNews(rows), warnings: [...new Set(warnings)] };
      if (!result.followUps.length && !result.background.length) return { ...result,
        emptyReason: !batches.flat().length ? 'NO_SEARCH_RESULTS' : !candidates.length ? 'NO_RELEVANT_MATCH'
          : warnings.includes('RELATION_CLASSIFICATION_FAILED') ? 'CLASSIFICATION_UNAVAILABLE'
          : dateBlocked ? 'DATE_UNVERIFIED' : 'NO_DIRECT_RELATION' };
      return result;
    } finally { child.abort(); }
  };
}
