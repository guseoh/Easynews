import assert from 'node:assert/strict';
import test from 'node:test';
import { streamResponse } from '../../vendor/siwc-local/dist/responses.js';
import { ChatGPTError } from '@siwc/local';
import { OpenAIWebSearchProvider, searchCandidates } from '../dist/web-search.js';
import { ChatGPTPlanProvider } from '../dist/chatgpt-plan.js';
import { createRelatedService } from '../dist/related.js';
import { createApp } from '../dist/app.js';
import { ApiError } from '../dist/explain.js';

const signal = () => new AbortController().signal;
const source = { title: '한국은행 기준금리 동결 이후 시장 반응', url: 'https://publisher.example/after?utm_source=test', publishedAt: 'fabricated' };
const item = { id: 'search-1', type: 'web_search_call', status: 'completed', results: [source], action: { type: 'search', sources: [{ url: source.url }, { title: '한국은행 기준금리 결정 배경', url: 'https://another.example/background' }] } };
const events = [ { type: 'response.web_search_call.completed', item_id: item.id }, { type: 'response.output_item.done', item }, { type: 'response.output_text.delta', delta: 'Generated prose is never a candidate: https://fake.example' }, { type: 'response.completed', response: { output: [] } } ];
const sse = (rows) => new Response(rows.map((row) => `data: ${JSON.stringify(row)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });

test('hosted search sends exact plan contract and consumes streamed results even when completed output is empty', async (t) => {
  let payload;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { payload = JSON.parse(options.body); return sse(events); });
  const provider = new OpenAIWebSearchProvider((options) => streamResponse('synthetic', options, options.signal));
  const rows = await provider.search('한국은행 기준금리 동결', signal());
  assert.equal(payload.model, 'gpt-6-luna'); assert.deepEqual(payload.reasoning, { effort: 'medium' });
  assert.deepEqual(payload.tools, [{ type: 'web_search', search_context_size: 'low' }]);
  assert.equal(payload.tool_choice, 'required'); assert.equal(payload.store, false); assert.equal(payload.stream, true);
  assert.deepEqual(payload.include, ['web_search_call.results', 'web_search_call.action.sources']);
  assert.equal(payload.return_token_budget, undefined); assert.equal(payload.max_output_tokens, undefined);
  assert.equal(rows.length, 2); assert.equal(rows[0].source, 'publisher.example');
  assert.equal(rows[0].publishedAt, undefined); assert.equal(JSON.stringify(rows).includes('fake.example'), false);
  assert.equal(rows[0].url, source.url);
});

test('candidate mapping rejects unsafe URLs, missing titles and obvious non-news formats without a publisher allowlist', () => {
  const urls = ['javascript:alert(1)', 'https://user:pass@publisher.example/a', 'https://youtube.com/watch?v=x', 'https://blog.naver.com/a', 'https://abc.tistory.com/1', 'https://note.com/user/n/blog', 'https://news.example/videos/25001', 'https://publisher.example/report.pdf'];
  const results = searchCandidates([{ type: 'web_search_call', results: [...urls.map((url) => ({ title: '제목', url })), { url: 'https://publisher.example/missing-title' }, { title: '새로운 언론사 제목', url: 'https://new-publisher.example/a' }] }]);
  assert.deepEqual(results, [{ title: '새로운 언론사 제목', url: 'https://new-publisher.example/a', source: 'new-publisher.example' }]);
});

test('interrupted, failed, incomplete and tool-free streams never succeed or expose partial candidates', async (t) => {
  for (const rows of [events.slice(0, -1), [{ type: 'response.failed', response: { error: { code: 'api_error', message: 'private' } } }], [{ type: 'response.incomplete' }], [{ type: 'response.completed' }]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => sse(rows));
    await assert.rejects(new OpenAIWebSearchProvider((options) => streamResponse('synthetic', options, options.signal)).search('query', signal()),
      (error) => error instanceof ApiError && !error.message.includes('private'));
    mock.mock.restore();
  }
});

const slow = (options) => new Promise((_resolve, reject) => {
  const timer = setTimeout(() => reject(Error('late')), 200);
  options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
});
test('search stage timeout is distinct from caller cancellation', async () => {
  await assert.rejects(new OpenAIWebSearchProvider(slow, 5).search('query', signal()), { code: 'NEWS_SEARCH_TIMEOUT', status: 504 });
  const controller = new AbortController(); const request = new OpenAIWebSearchProvider(slow).search('query', controller.signal);
  controller.abort(); await assert.rejects(request, { code: 'REQUEST_CANCELLED', status: 499 });
});

test('search uses existing session consent and usage handling, without billing-key fallback', async () => {
  let calls = 0;
  const client = { getSession: async () => ({ sharing: true }), listModels: async () => [],
    streamResponse: async () => { calls++; throw new ChatGPTError('subscription_sharing_usage_limit_exceeded', 'private'); } };
  const plan = new ChatGPTPlanProvider(client);
  await assert.rejects(plan.newsSearch('query', signal()), { code: 'CHATGPT_USAGE_LIMIT' });
  await assert.rejects(plan.newsSearch('query', signal()), { code: 'CHATGPT_USAGE_LIMIT' });
  assert.equal(calls, 1);
  const disconnected = new ChatGPTPlanProvider({ ...client, getSession: async () => ({ sharing: false }) });
  await assert.rejects(disconnected.newsSearch('query', signal()), { code: 'CHATGPT_SIGN_IN_REQUIRED' });
});

const current = { title: '한국은행 기준금리 동결', url: 'https://publisher.example/current', canonicalUrl: 'https://publisher.example/current', publishedAt: '2026-10-02T10:00:00+09:00', textContent: '한국은행 기준금리와 물가 동향을 확인한다. '.repeat(10) };
const fingerprint = { event: '한국은행 기준금리 동결', entities: ['한국은행'], organizations: ['한국은행'], people: [], locations: [], keywords: ['기준금리', '동결'], searchQueries: ['한국은행 기준금리', '한국은행 금리 반응'] };
test('combined search retains event/title context and caps, enriches and re-deduplicates before temporal classification', async () => {
  let searches = 0; let enrichedCount; let classified; const stages = [];
  const rows = Array.from({ length: 40 }, (_, i) => ({ title: `한국은행 기준금리 동결 반응 ${String.fromCharCode(0xAC00 + i * 7)}`, url: `https://publisher${i}.example/${i}`, source: `publisher${i}.example` }));
  rows.push({ ...rows[0], url: current.url });
  const result = await createRelatedService(async (query) => {
    searches++; const data = JSON.parse(query); assert.equal(data.title, current.title); assert.deepEqual(data.entities, fingerprint.entities); return rows;
  }, { fingerprint: async () => fingerprint, classify: async (_input, _fp, candidates) => {
    classified = candidates;
    return candidates.map((_row, index) => ({ index, relation: 'follow_up', relationReason: '구체적 사건 반응' }));
  } }, { combinedSearch: true, enrich: async (candidates) => {
    enrichedCount = candidates.length;
    return candidates.map((row, i) => ({ ...row, title: i === 0 ? current.title : row.title,
      publishedAt: i === 1 ? '2026-10-02T02:00:00Z' : i === 2 ? '2026-10-01T00:00:00Z' : undefined }));
  } })(current, signal(), (stage) => stages.push(stage));
  assert.equal(searches, 1); assert.ok(enrichedCount <= 12); assert.ok(classified.length <= 12);
  assert.ok(classified.every((row) => row.url !== current.url && row.title !== current.title));
  assert.deepEqual(stages, ['searching', 'checking', 'classifying']);
  assert.equal(result.followUps.length, 1); assert.ok(result.warnings.includes('TIME_UNKNOWN'));
});

test('related HTTP streams actual stages and safe errors, preserves JSON and aborts its own deadline', async (t) => {
  const id = 'a'.repeat(32); let cancelled = false;
  const app = createApp({ extensionId: id, relatedTimeoutMs: 15 }, async () => '설명', async (_input, sig, progress) => {
    progress?.('searching');
    await new Promise((resolve) => { sig.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }); });
    return { followUps: [], background: [], warnings: [] };
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.close(); app.closeAllConnections(); });
  const url = `http://127.0.0.1:${app.address().port}/api/related`;
  const headers = { 'Content-Type': 'application/json', 'X-Easynews-Extension': id, Accept: 'application/x-ndjson' };
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(current) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const rows = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0], { stage: 'searching' }); assert.equal(rows[1].error.code, 'RELATED_TIMEOUT'); assert.equal(cancelled, true);
  const json = await fetch(url, { method: 'POST', headers: { ...headers, Accept: 'application/json' }, body: JSON.stringify(current) });
  assert.equal(json.status, 504); assert.equal((await json.json()).error.code, 'RELATED_TIMEOUT');
});
