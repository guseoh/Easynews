import { deduplicate, enforceTime, fallbackFingerprint, fallbackRelations, rankCandidates, sourceDiversity } from './news-ranking.js';
import { ApiError } from './explain.js';
import { RELATED_LIMITS, dateTime, validateFingerprint, validateRelations, type Related, type RelatedArticle, type RelatedLlm, type RelatedWarning, type SearchNews } from './related-types.js';

export function createRelatedService(search: SearchNews, llm?: RelatedLlm): Related {
  return async (input, signal) => {
    // No cache or history: all features, candidates and decisions live in this request.
    const child = new AbortController();
    const requestSignal = AbortSignal.any([signal, child.signal]);
    const warnings: RelatedWarning[] = [];
    try {
      requestSignal.throwIfAborted();
      let fingerprint = fallbackFingerprint(input);
      if (llm) {
        try { fingerprint = validateFingerprint(await llm.fingerprint(input, requestSignal)); }
        catch (error) { requestSignal.throwIfAborted(); if (error instanceof ApiError && error.code.startsWith('CHATGPT_') && error.code !== 'CHATGPT_FAILED') throw error; warnings.push('FINGERPRINT_FALLBACK'); }
      } else warnings.push('RULE_BASED');
      const queries = [...new Set(fingerprint.searchQueries)].slice(0, RELATED_LIMITS.queries);
      const batches = await Promise.all(queries.map((query) => search(query, requestSignal)));
      requestSignal.throwIfAborted();
      const candidates = rankCandidates(deduplicate(batches.flat(), input), fingerprint, input);
      let decisions = fallbackRelations(input, candidates);
      if (llm && candidates.length) {
        try { decisions = validateRelations({ relations: await llm.classify(input, fingerprint, candidates, requestSignal) }, candidates.length); }
        catch (error) { requestSignal.throwIfAborted(); if (error instanceof ApiError && error.code.startsWith('CHATGPT_') && error.code !== 'CHATGPT_FAILED') throw error; warnings.push('RELATION_CLASSIFICATION_FAILED'); }
      }
      requestSignal.throwIfAborted();
      const followUps: RelatedArticle[] = []; const background: RelatedArticle[] = [];
      if (dateTime(input.publishedAt) === undefined || candidates.some((candidate) => dateTime(candidate.publishedAt) === undefined)) warnings.push('TIME_UNKNOWN');
      for (const decision of decisions.sort((a, b) => a.index - b.index)) {
        const candidate = candidates[decision.index]!;
        const checked = enforceTime(input, candidate, decision);
        if (checked.relation !== 'follow_up' && checked.relation !== 'background') continue;
        const article: RelatedArticle = { title: candidate.title, url: candidate.originalUrl || candidate.url, source: candidate.source,
          ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}), relationReason: checked.relationReason };
        (checked.relation === 'follow_up' ? followUps : background).push(article);
      }
      // Dates constrain relation labels; the source limit never fills gaps with weak matches.
      return { followUps: sourceDiversity(followUps), background: sourceDiversity(background), warnings: [...new Set(warnings)] };
    } finally { child.abort(); }
  };
}
