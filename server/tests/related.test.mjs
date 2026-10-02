import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { ApiError } from '../dist/explain.js';
import { validateFingerprint, validateRelatedInput, validateRelations, dateTime } from '../dist/related-types.js';
import { canonicalizeUrl, deduplicate, titleSimilarity, fallbackFingerprint, rankCandidates, fallbackRelations, enforceTime, sourceDiversity } from '../dist/news-ranking.js';
import { normalizeSearchResults, stripNewsHtml, createNaverSearch } from '../dist/naver.js';
import { createRelatedLlm } from '../dist/related-llm.js';
import { createRelatedService } from '../dist/related.js';

const input = { title: '한국은행 기준금리 동결', url: 'https://news.example/current', siteName: '현재 언론사', publishedAt: '2026-10-02T10:00:00+09:00', textContent: '한국은행 기준금리와 물가 상황을 살펴봅니다. '.repeat(10) };
const fingerprint = { event: input.title, entities: ['한국은행', '이창용'], organizations: ['한국은행'], people: ['이창용'], locations: ['대한민국'], keywords: ['한국은행', '기준금리', '동결'], searchQueries: ['한국은행 기준금리', '한국은행 기준금리 후속', '한국은행 기준금리 배경'] };
const candidate = (title, url, publishedAt = '2026-10-02T11:00:00+09:00', source = '테스트 언론사') => ({ title, url: `https://news.example/${url}`, source, publishedAt });
const candidates = [candidate('한국은행 기준금리 동결 이후 시장 반응', 'after'), candidate('한국은행 기준금리 결정의 배경 물가 지표', 'before', '2026-10-01T10:00:00+09:00'), candidate('한국은행 기준금리 과거 결정', 'old', '2026-09-20'), candidate('한국은행 기준금리 설명', 'unknown', undefined), candidate('한국은행 기준금리 동결 이창용 기자회견', 'irrelevant')];
candidates[3].publishedAt = undefined;
const signal = () => new AbortController().signal;
const output = (value) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('related input is minimal, bounded and rejects article bodies, selection and histories', () => {
  assert.deepEqual(validateRelatedInput(input), { ...input, textContent: input.textContent.trim() });
  for (const body of [{ ...input, textContent: '가'.repeat(1201) }, { ...input, content: 'entire article' }, { ...input, selectedText: 'selection' }, { ...input, history: [] }, { ...input, url: 'javascript:alert(1)' }, { ...input, canonicalUrl: 'file:///private' }, { ...input, siteName: 123 }]) {
    assert.throws(() => validateRelatedInput(body), (error) => error.code === 'INVALID_RELATED_INPUT');
  }
  assert.throws(() => validateRelatedInput({ ...input, textContent: 'short' }), (error) => error.code === 'CONTEXT_INSUFFICIENT');
  assert.equal(validateRelatedInput({ ...input, publishedAt: 'not-a-date' }).publishedAt, 'not-a-date');
});

test('fingerprint runtime schema rejects unknown fields, invalid lists and excessive queries', () => {
  assert.deepEqual(validateFingerprint(fingerprint), fingerprint);
  for (const value of [{ ...fingerprint, keywords: [] }, { ...fingerprint, people: [123] }, { ...fingerprint, extra: 'data' }, { ...fingerprint, searchQueries: ['a', 'b', 'c', 'd'] }, { ...fingerprint, event: '' }]) assert.throws(() => validateFingerprint(value));
});

test('fallback search queries are bounded and preserve the event when LLM is unavailable', () => {
  const value = validateFingerprint(fallbackFingerprint(input));
  assert.ok(value.searchQueries.length <= 3);
  assert.ok(value.searchQueries.every((query) => query.includes('기준금리') && query.length <= 100));
  assert.ok(value.organizations.includes('한국은행'));
});

test('HTML tags and named/numeric entities normalize to plain search metadata', () => {
  assert.equal(stripNewsHtml('<b>한국은행</b> &amp; 금리 &#x26; &#38; &quot;결정&quot;'), '한국은행 & 금리 & & "결정"');
  assert.equal(stripNewsHtml('&lt;b&gt;금리&lt;/b&gt; &#x110000;'), '금리');
  const rows = normalizeSearchResults({ items: [{ title: '<b>한국은행</b> 금리', description: '<b>배경</b>&nbsp;문맥', link: 'https://portal.example/a', originallink: 'https://publisher.example/a', pubDate: 'Fri, 02 Oct 2026 10:00:00 +0900' }] });
  assert.equal(rows[0].url, 'https://portal.example/a');
  assert.equal(rows[0].originalUrl, 'https://publisher.example/a');
  assert.equal(rows[0].source, 'publisher.example');
  assert.equal(rows[0].description, '배경 문맥');
  assert.equal(rows[0].publishedAt, '2026-10-02T01:00:00.000Z');
  assert.throws(() => normalizeSearchResults({ items: [{ title: 123, link: 'https://news.example' }] }));
  assert.deepEqual(normalizeSearchResults({ items: [{ title: '제목', link: 'javascript:alert(1)' }] }), []);
  assert.equal(normalizeSearchResults({ items: [{ title: '제목', link: 'https://news.example', pubDate: 'invalid' }] })[0].publishedAt, undefined);
});

test('URL canonicalization strips tracking but preserves identity and NAVER oid/aid', () => {
  assert.equal(canonicalizeUrl('https://www.publisher.example/story/?id=42&utm_source=x&gclid=y#section'), 'https://publisher.example/story?id=42');
  assert.equal(canonicalizeUrl('https://n.news.naver.com/mnews/article/009/0005743196?sid=101'), 'https://n.news.naver.com/article/009/0005743196');
  assert.equal(canonicalizeUrl('https://news.naver.com/main/read.naver?oid=009&aid=0005743196'), 'https://n.news.naver.com/article/009/0005743196');
  assert.equal(canonicalizeUrl('javascript:alert(1)'), '');
});

test('exact URL/original URL, tracking copies, identical and near duplicate titles are removed', () => {
  const original = candidate('한국은행 기준금리 이후 시장의 새로운 반응', 'a');
  const results = deduplicate([original, { ...original, url: original.url + '?utm_source=x' }, { ...original, url: 'https://portal.example/a', originalUrl: original.url }, { ...original, url: 'https://news.example/copy' }, { ...original, title: original.title + '!', url: 'https://news.example/near' }, candidate(input.title, 'current-copy'), candidate('한국은행 기준금리의 이전 물가 배경', 'different')], input);
  assert.equal(results.length, 2);
  assert.ok(titleSimilarity(original.title, original.title + '…') >= 0.93);
  assert.ok(titleSimilarity('한국은행 기준금리 동결 이후 기자회견', '한국은행 기준금리 이전 물가 지표') < 0.93);
});

test('current portal and original aliases are excluded even if a copy title differs', () => {
  const current = { ...input, url: 'https://n.news.naver.com/article/009/123', canonicalUrl: 'https://publisher.example/a' };
  assert.deepEqual(deduplicate([{ ...candidate('한국은행 기준금리 결정 다른 제목', 'x'), url: 'https://n.news.naver.com/mnews/article/009/123?cds=x', originalUrl: 'https://publisher.example/a?utm_source=x' }], current), []);
});

test('ranking favors event/entity keywords and rejects subject-only unrelated stories before classification', () => {
  const weak = candidate('한국은행 직원 채용 발표', 'jobs');
  const unrelated = candidate('스포츠 경기 결과 발표', 'sports');
  const strongest = candidate('한국은행 기준금리 동결 이창용 기자회견', 'strong');
  const ranked = rankCandidates([weak, unrelated, candidates[0], strongest], fingerprint, input);
  assert.equal(ranked[0], strongest);
  assert.equal(ranked.length, 2);
  assert.ok(rankCandidates(Array.from({ length: 30 }, (_, i) => candidate(`한국은행 기준금리 동결 반응 ${i}`, String(i))), fingerprint, input).length <= 12);
});

test('date parsing, past/equal follow-up blocking, future-background blocking and unknown fallback are enforced', () => {
  const decision = { index: 0, relation: 'follow_up', relationReason: '후속 관계' };
  assert.equal(dateTime('invalid'), undefined);
  assert.equal(dateTime(), undefined);
  assert.equal(dateTime('2026-10-02'), undefined);
  assert.equal(dateTime('2026-02-30T10:00:00+09:00'), undefined);
  assert.equal(enforceTime(input, candidates[0], decision).relation, 'follow_up');
  for (const publishedAt of [input.publishedAt, '2026-09-01', undefined, 'invalid']) assert.equal(enforceTime(input, { ...candidates[0], publishedAt }, decision).relation, 'related');
  assert.equal(enforceTime({ ...input, publishedAt: undefined }, candidates[0], decision).relation, 'related');
  assert.equal(enforceTime(input, candidates[0], { ...decision, relation: 'background' }).relation, 'related');
  assert.match(enforceTime(input, candidates[3], { ...decision, relation: 'background' }).relationReason, /시각 미확인/);
});

test('source diversity caps each source at two and groups at four without filling weak matches', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ title: String(index), url: `https://news.example/${index}`, source: index < 4 ? 'Same' : `Other ${index}`, relationReason: '관계' }));
  const selected = sourceDiversity(rows);
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((row) => row.source === 'Same').length, 2);
  assert.equal(sourceDiversity(rows.slice(0, 4)).length, 2);
});

test('relation schema requires each known index exactly once, valid enum and short plain reason', () => {
  assert.equal(validateRelations({ relations: [{ index: 0, relation: 'background', relationReason: '이전 상황과의 관계' }] }, 1).length, 1);
  for (const relations of [[], [{ index: 1, relation: 'related', relationReason: '관계' }], [{ index: 0, relation: 'summary', relationReason: '관계' }], [{ index: 0, relation: 'background', relationReason: '가'.repeat(181) }], [{ index: 0, relation: 'background', relationReason: '<b>관계</b>' }]]) assert.throws(() => validateRelations({ relations }, 1));
  assert.throws(() => validateRelations({ relations: [{ index: 0, relation: 'background', relationReason: '관계' }, { index: 0, relation: 'related', relationReason: '관계' }] }, 2));
});

test('pipeline caps searches, deduplicates, enforces times, removes irrelevant and returns metadata only', async () => {
  let calls = 0; let classified;
  const llm = { fingerprint: async () => fingerprint, classify: async (_input, _fp, shortlist) => {
    classified = shortlist;
    return shortlist.map((row, index) => ({ index, relation: row.url.endsWith('/before') ? 'background' : row.url.endsWith('/irrelevant') ? 'irrelevant' : 'follow_up', relationReason: '현재 사건과의 관계' })).reverse();
  } };
  const result = await createRelatedService(async () => { calls++; return [...candidates, candidate('스포츠 경기', 'unrelated')]; }, llm)(input, signal());
  assert.equal(calls, 3);
  assert.equal(classified.length, 5);
  assert.equal(result.followUps.length, 1);
  assert.equal(result.background.length, 1);
  assert.ok(result.warnings.includes('TIME_UNKNOWN'));
  for (const row of [...result.followUps, ...result.background]) assert.deepEqual(Object.keys(row).sort(), ['publishedAt', 'relationReason', 'source', 'title', 'url']);
});

test('LLM failure falls back queries and relations; no key uses conservative rule results', async () => {
  const failing = { fingerprint: async () => { throw Error('private'); }, classify: async () => { throw Error('private'); } };
  const result = await createRelatedService(async () => candidates.slice(0, 2), failing)(input, signal());
  assert.ok(result.warnings.includes('FINGERPRINT_FALLBACK'));
  assert.ok(result.warnings.includes('RELATION_CLASSIFICATION_FAILED'));
  assert.equal(result.followUps.length, 1);
  assert.equal(result.background.length, 1);
  assert.ok(!JSON.stringify(result).includes('private'));
  const rules = await createRelatedService(async () => candidates.slice(0, 2))(input, signal());
  assert.ok(rules.warnings.includes('RULE_BASED'));
});

test('zero search results return empty groups and do not call relation LLM', async () => {
  const result = await createRelatedService(async () => [], { fingerprint: async () => fingerprint, classify: async () => { assert.fail('should not classify empty shortlist'); } })(input, signal());
  assert.deepEqual(result, { followUps: [], background: [], warnings: [] });
});

test('Naver adapter keeps credentials server-side, limits results and propagates safe errors', async () => {
  let captured;
  const search = createNaverSearch({ clientId: 'test-id', clientSecret: 'test-secret' }, async (url, options) => { captured = { url: String(url), options }; return Response.json({ items: [] }); });
  assert.deepEqual(await search('한국은행 기준금리', signal()), []);
  const url = new URL(captured.url);
  assert.equal(url.origin + url.pathname, 'https://openapi.naver.com/v1/search/news.json');
  assert.equal(url.searchParams.get('display'), '20');
  assert.equal(url.searchParams.get('query'), '한국은행 기준금리');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.headers['X-Naver-Client-Secret'], 'test-secret');
  assert.ok(!captured.url.includes('test-secret'));
  await assert.rejects(createNaverSearch({ clientId: '', clientSecret: '' })('query', signal()), (error) => error.code === 'NEWS_SEARCH_NOT_CONFIGURED');
  for (const [status, code] of [[403, 'NEWS_SEARCH_CONFIGURATION_ERROR'], [429, 'NEWS_SEARCH_FAILED'], [500, 'NEWS_SEARCH_FAILED']]) {
    await assert.rejects(createNaverSearch({ clientId: 'test', clientSecret: 'test' }, async () => new Response('private', { status }))('query', signal()), (error) => error.code === code && !error.message.includes('private'));
  }
  await assert.rejects(createNaverSearch({ clientId: 'test', clientSecret: 'test' }, async () => Response.json({ items: 'invalid' }))('query', signal()), (error) => error.code === 'NEWS_SEARCH_INVALID_RESPONSE');
  await assert.rejects(createNaverSearch({ clientId: 'test', clientSecret: 'test' }, async () => { throw new TypeError('private'); })('query', signal()), (error) => error.code === 'NEWS_SEARCH_NETWORK_ERROR');
  await assert.rejects(createNaverSearch({ clientId: 'test', clientSecret: 'test' }, async () => new Response('not JSON'))('query', signal()), (error) => error.code === 'NEWS_SEARCH_INVALID_RESPONSE');
});

test('Naver and related OpenAI timeouts propagate safely; cancellation is not treated as fallback', async () => {
  const slow = (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(Error('late')), 100);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  await assert.rejects(createNaverSearch({ clientId: 'test', clientSecret: 'test', timeoutMs: 5 }, slow)('query', signal()), (error) => error.code === 'NEWS_SEARCH_TIMEOUT');
  await assert.rejects(createRelatedLlm({ apiKey: 'test', model: 'test', timeoutMs: 5 }, slow).fingerprint(input, signal()), (error) => error.code === 'RELATION_CLASSIFICATION_FAILED');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createRelatedLlm({ apiKey: 'test', model: 'test' }, slow).fingerprint(input, controller.signal), (error) => error.code === 'REQUEST_CANCELLED');
});

test('structured OpenAI requests use strict schemas, bounded excerpts and store:false; invalid outputs fail', async () => {
  const calls = [];
  const llm = createRelatedLlm({ apiKey: 'test-key', model: 'test-model' }, async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const payload = body.text.format.name === 'event_fingerprint' ? fingerprint : { relations: [{ index: 0, relation: 'follow_up', relationReason: '현재 사건 이후 반응' }] };
    return Response.json(output(payload));
  });
  await llm.fingerprint(input, signal());
  await llm.classify(input, fingerprint, [candidates[0]], signal());
  for (const body of calls) { assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.schema.additionalProperties, false); assert.equal(body.previous_response_id, undefined); assert.match(body.instructions, /신뢰하지 않는 데이터/); }
  assert.ok(JSON.parse(calls[0].input).excerpt.length <= 1200);
  assert.ok(JSON.parse(calls[1].input).current.excerpt.length <= 600);
  const invalid = createRelatedLlm({ apiKey: 'test', model: 'test' }, async () => Response.json(output({ invalid: true })));
  await assert.rejects(invalid.fingerprint(input, signal()));
  await assert.rejects(invalid.classify(input, fingerprint, [candidates[0]], signal()));
});

async function http(t, related) {
  const id = 'a'.repeat(32);
  const app = createApp({ extensionId: id }, async () => '설명 기능 정상', related);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Easynews-Extension': id, Origin: `chrome-extension://${id}` };
  return { base, headers, post: (path, body, options = {}) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), ...options }) };
}

test('related HTTP API has matching access guard/preflight and independent explanation error state', async (t) => {
  const { post, base, headers } = await http(t, createRelatedService(createNaverSearch({ clientId: '', clientSecret: '' })));
  assert.equal((await post('/api/related', input)).status, 503);
  assert.equal((await post('/api/explain', { mode: 'simple', selectedText: '선택 문장' })).status, 200);
  assert.equal((await post('/api/related', { ...input, textContent: 'short' })).status, 422);
  assert.equal((await post('/api/related', { ...input, content: 'full article' })).status, 400);
  assert.equal((await post('/api/related', input, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/related', { method: 'OPTIONS', headers: { Origin: headers.Origin } })).status, 204);
});

test('related HTTP pipeline returns no-store output with original publisher URLs', async (t) => {
  const original = { ...candidates[0], originalUrl: 'https://publisher.example/after' };
  const { post } = await http(t, createRelatedService(async () => [original]));
  const response = await post('/api/related', input);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).followUps[0].url, original.originalUrl);
});

test('request cancellation prevents classification and cancels pending searches', async () => {
  const controller = new AbortController(); let begun;
  const started = new Promise((resolve) => { begun = resolve; });
  let aborted = 0;
  const service = createRelatedService((_query, signal) => new Promise((_resolve, reject) => { begun(); signal.addEventListener('abort', () => { aborted++; reject(new ApiError(499, 'REQUEST_CANCELLED', '취소')); }, { once: true }); }));
  const result = service(input, controller.signal);
  await started; controller.abort();
  await assert.rejects(result);
  assert.equal(aborted, 3);
});
