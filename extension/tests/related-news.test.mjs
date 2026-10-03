import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/related-news.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports, URL, TextDecoder, chrome: { runtime: { id: 'test-extension' } } });
const { requestRelated, validateRelatedResult } = module.exports;
const article = { title: '현재 기사', url: 'https://news.example/current', canonicalUrl: 'https://publisher.example/current', siteName: '출처', publishedAt: '2026-10-02', textContent: '합성 도입부 '.repeat(250), confidence: 'high', extractionMethod: 'readability', selectedText: 'private selection', surroundingContext: 'private surrounding' };
const row = { title: '<b>제목도 일반 텍스트</b>', url: 'https://publisher.example/after', source: '언론사', relationReason: '현재 사건 이후의 반응' };
const result = { followUps: [row], background: [], warnings: [] };

test('related request sends only bounded metadata/lead, never selection, context or extraction internals', async () => {
  let captured;
  await requestRelated(article, new AbortController().signal, async (url, options) => { captured = { url, options }; return Response.json(result); });
  assert.equal(captured.url, 'http://127.0.0.1:3000/api/related');
  assert.equal(captured.options.cache, 'no-store');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['canonicalUrl', 'publishedAt', 'siteName', 'textContent', 'title', 'url']);
  assert.equal(body.textContent.length, 1200);
  assert.ok(!captured.options.body.includes('private'));
});

test('insufficient context prevents network calls and safe server errors ignore upstream text', async () => {
  let calls = 0;
  await assert.rejects(requestRelated({ ...article, confidence: 'low' }, new AbortController().signal, async () => { calls++; }), /기사 문맥이 부족/);
  assert.equal(calls, 0);
  await assert.rejects(requestRelated(article, new AbortController().signal, async () => Response.json({ error: { code: 'NEWS_SEARCH_NOT_CONFIGURED', message: 'private provider text' } }, { status: 503 })), /ChatGPT plan 연결/);
  await assert.rejects(requestRelated(article, new AbortController().signal, async () => new Response('private malformed response')), /응답을 읽지 못/);
});

const ndjson = (lines) => new Response(lines.map((line) => JSON.stringify(line) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson' } });
test('related stream forwards actual progress, validates final result and rejects partial/error streams', async () => {
  const stages = [];
  assert.deepEqual(JSON.parse(JSON.stringify(await requestRelated(article, new AbortController().signal,
    async () => ndjson([{ stage: 'searching' }, { stage: 'checking' }, { stage: 'classifying' }, { result }]), (stage) => stages.push(stage)))), result);
  assert.deepEqual(stages, ['searching', 'checking', 'classifying']);
  await assert.rejects(requestRelated(article, new AbortController().signal, async () => ndjson([{ stage: 'searching' }])), /완료되지/);
  await assert.rejects(requestRelated(article, new AbortController().signal, async () => ndjson([{ error: { code: 'RELATED_TIMEOUT', message: 'secret' } }])), /시간이 초과/);
  await assert.rejects(requestRelated(article, new AbortController().signal, async () => ndjson([{ result: { ...result, history: [] } }])), /응답을 읽지/);
});

test('cancellation after stream read suppresses progress and stale final result', async () => {
  const controller = new AbortController(); let progress = 0;
  const response = new Response(new ReadableStream({ pull(stream) {
    stream.enqueue(new TextEncoder().encode(JSON.stringify({ stage: 'checking' }) + '\n' + JSON.stringify({ result }) + '\n'));
    controller.abort(); stream.close();
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  await assert.rejects(requestRelated(article, controller.signal, async () => response, () => progress++));
  assert.equal(progress, 0);
});

test('related responses validate groups, unsafe URLs, count, reason length and warning schemas', () => {
  assert.equal(validateRelatedResult(result).followUps.length, 1);
  for (const value of [{ ...result, followUps: [{ ...row, url: 'javascript:alert(1)' }] }, { ...result, followUps: [{ ...row, url: 'https://user:password@news.example' }] }, { ...result, background: [{ ...row, relationReason: '가'.repeat(181) }] }, { ...result, followUps: Array(5).fill(row) }, { ...result, warnings: ['provider private error'] }, { ...result, history: [] }]) assert.throws(() => validateRelatedResult(value));
});
