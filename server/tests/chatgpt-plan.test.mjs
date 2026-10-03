import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTError } from '@siwc/local';
import { ChatGPTPlanProvider, planError } from '../dist/chatgpt-plan.js';
import { streamResponse } from '../../vendor/siwc-local/dist/responses.js';
import { createRelatedService } from '../dist/related.js';
import { createApp } from '../dist/app.js';

const signal = () => new AbortController().signal;
const session = { status: 'connected', sharing: true, profileId: 'profile', identity: { email: 'synthetic@example.test' } };
function client(overrides = {}) {
  return { getSession: async () => session, listModels: async () => [{ slug: 'future-luna', displayName: 'Luna' }],
    streamResponse: async () => ({ text: '설명' }), signIn: async () => session, cancelSignIn() {}, disconnect: async () => {}, listProfiles: async () => [], ...overrides };
}
const article = { title: '한국은행 기준금리 동결', url: 'https://example.test/news', textContent: '한국은행 금리 동결 결정과 물가 상황을 살펴본다. '.repeat(5), publishedAt: '2026-10-02T00:00:00Z' };
const fingerprint = { event: '금리 동결', entities: ['한국은행'], organizations: ['한국은행'], people: [], locations: [], keywords: ['금리', '동결'], searchQueries: ['한국은행 금리 동결'] };
const candidate = { title: '한국은행 금리 동결 배경', url: 'https://example.test/background', source: 'example.test', publishedAt: '2026-10-01T00:00:00Z', description: '물가 상황' };

test('model policy preserves the pinned model when omitted from the display catalog', async () => {
  for (const models of [[{ slug: 'gpt-5.6-luna', displayName: 'Luna' }], []]) {
    const provider = new ChatGPTPlanProvider(client({ listModels: async () => models }));
    assert.equal((await provider.status()).model, 'gpt-6-luna');
  }
  const provider = new ChatGPTPlanProvider(client({ listModels: async () => { throw new ChatGPTError('network_error', ''); } }));
  await assert.rejects(provider.explain({ mode: 'simple', articleTitle: '제목', selectedText: '선택' }, signal()), { code: 'CHATGPT_FAILED' });
});

test('three explanation modes preserve minimal inputs and use separate plan request options', async () => {
  let discoveries = 0;
  const requests = [];
  const provider = new ChatGPTPlanProvider(client({ listModels: async () => { discoveries++; return [{ slug: 'available-luna', displayName: 'Luna' }]; },
    streamResponse: async (options) => { requests.push(options); options.onDelta('설명'); return { text: '설명' }; } }));
  for (const mode of ['simple', 'why', 'background']) assert.equal(await provider.explain({ mode, articleTitle: '제목', selectedText: '선택', surroundingContext: '주변' }, signal()), '설명');
  assert.equal(discoveries, 1);
  for (const options of requests) {
    assert.equal(options.model, 'gpt-6-luna');
    assert.deepEqual(options.reasoning, { effort: 'xhigh' });
    assert.deepEqual(JSON.parse(options.input[0].content), { articleTitle: '제목', selectedText: '선택', surroundingContext: '주변' });
    assert.equal(options.input[0].role, 'user');
    assert.equal(options.max_output_tokens, undefined);
  }
});

test('Phase 4 fingerprint/classification retain bounded metadata and runtime validation', async () => {
  const requests = [];
  const provider = new ChatGPTPlanProvider(client({ streamResponse: async (options) => {
    requests.push(options); return { text: JSON.stringify(requests.length === 1 ? fingerprint : { relations: [{ index: 0, relation: 'background', relationReason: '이전 배경을 설명합니다.' }] }) };
  } }));
  assert.deepEqual(await provider.relatedLlm.fingerprint(article, signal()), fingerprint);
  const result = await provider.relatedLlm.classify(article, fingerprint, [candidate], signal());
  assert.equal(result[0].relation, 'background');
  assert.deepEqual(Object.keys(JSON.parse(requests[0].input[0].content)), ['title', 'excerpt']);
  const classification = JSON.parse(requests[1].input[0].content);
  assert.ok(requests.every((request) => request.reasoning.effort === 'medium'));
  assert.equal(classification.candidates[0].temporal, 'before');
  assert.equal(classification.candidates[0].description, undefined);
  assert.equal(classification.current.excerpt.length <= 600, true);
  assert.equal(JSON.stringify(classification).includes('https://'), false);
  assert.match(requests[1].instructions, /schema/);
});

test('usage errors pause new plan requests and Phase 4 surfaces them before search', async () => {
  let calls = 0, searches = 0;
  const provider = new ChatGPTPlanProvider(client({ streamResponse: async () => { calls++; throw new ChatGPTError('subscription_sharing_usage_limit_exceeded', 'secret'); } }));
  const explain = () => provider.explain({ mode: 'simple', articleTitle: '제목', selectedText: '선택' }, signal());
  await assert.rejects(explain(), { code: 'CHATGPT_USAGE_LIMIT', status: 429 });
  await assert.rejects(explain(), { code: 'CHATGPT_USAGE_LIMIT' });
  await assert.rejects(createRelatedService(async () => { searches++; return []; }, provider.relatedLlm)(article, signal()), { code: 'CHATGPT_USAGE_LIMIT' });
  assert.equal(calls, 1); assert.equal(searches, 0);
  await provider.recheck();
  await assert.rejects(explain(), { code: 'CHATGPT_USAGE_LIMIT' }); assert.equal(calls, 2);
});

test('disconnect blocks new calls even when remote revoke fails; session excludes secrets', async () => {
  const provider = new ChatGPTPlanProvider(client({ getSession: async () => ({ ...session, accessToken: 'secret', error: { code: 'network_error', message: 'secret token URL' } }),
    disconnect: async () => { throw new ChatGPTError('revocation_failed', 'secret token URL'); } }));
  await assert.rejects(provider.disconnect(), { code: 'CHATGPT_REVOCATION_UNCONFIRMED' });
  await assert.rejects(provider.explain({ mode: 'simple', articleTitle: 'title', selectedText: 'selection' }, signal()), { code: 'CHATGPT_SIGN_IN_REQUIRED' });
  const status = await provider.status();
  assert.equal(status.status, 'disconnected'); assert.equal(status.sharing, false);
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal(planError(new Error('Bearer secret')).message.includes('secret'), false);
  assert.equal(planError(new ChatGPTError('storage_unavailable', 'secret')).code, 'CHATGPT_STORAGE_ERROR');
  assert.equal(planError(new ChatGPTError('access_denied', 'secret', false, 403)).code, 'CHATGPT_ACCESS_DENIED');
  assert.equal(planError(new ChatGPTError('api_error', 'secret', false, 401)).code, 'CHATGPT_AUTH_ERROR');
});

test('disconnect during sign-in cannot revive the local session on late completion', async () => {
  let finish;
  const provider = new ChatGPTPlanProvider(client({ signIn: () => new Promise((resolve) => { finish = resolve; }) }));
  provider.beginSignIn();
  assert.throws(() => provider.beginSignIn(), { code: 'CHATGPT_BUSY' });
  await provider.disconnect(); finish(session);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await provider.status()).sharing, false);
});

const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
test('official SSE builder sets store=false/stream=true and omits unsupported fields', async (t) => {
  let payload;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.redirect, 'error');
    payload = JSON.parse(options.body);
    return sse({ type: 'response.output_text.delta', delta: '쉬운 ' }, { type: 'response.output_text.delta', delta: '설명' }, { type: 'response.completed' });
  });
  assert.deepEqual(await streamResponse('synthetic', { model: 'discovered', instructions: '설명', input: [{ role: 'user', content: '최소 문맥' }] }, signal()), { text: '쉬운 설명' });
  assert.deepEqual(Object.keys(payload).sort(), ['model', 'input', 'instructions', 'store', 'stream'].sort());
  assert.equal(payload.store, false); assert.equal(payload.stream, true);
  await streamResponse('synthetic', { model: 'gpt-6-luna', reasoning: { effort: 'xhigh' }, input: '최소 문맥' }, signal());
  assert.deepEqual(Object.keys(payload).sort(), ['model', 'input', 'reasoning', 'store', 'stream'].sort());
  assert.deepEqual(payload.reasoning, { effort: 'xhigh' });
  assert.equal(payload.store, false); assert.equal(payload.stream, true);
});

test('SSE failed, incomplete, interruption, malformed and transport failure never return partial success', async (t) => {
  for (const [response, code] of [
    [sse({ type: 'response.output_text.delta', delta: '부분' }), 'stream_interrupted'],
    [sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret' } } }), 'subscription_sharing_usage_limit_exceeded'],
    [sse({ type: 'response.incomplete' }), 'response_incomplete'],
    [new Response('data: malformed\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 'invalid_stream'],
    [new Response(new ReadableStream({ start(controller) { controller.error(new Error('secret')); } }), { headers: { 'Content-Type': 'text/event-stream' } }), 'stream_interrupted'],
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(streamResponse('synthetic', { model: 'discovered', input: [{ role: 'user', content: '최소' }] }, signal()), { code }); mock.mock.restore();
  }
});

test('local auth endpoints preserve Origin/Host/client guards and reject credentials in request bodies', async (t) => {
  const provider = new ChatGPTPlanProvider(client());
  const id = 'a'.repeat(32);
  const app = createApp({ extensionId: id, providerId: provider.id }, provider.explain, undefined, provider);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.close(); app.closeAllConnections(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(base + '/api/ai/status')).status, 403);
  assert.equal((await fetch(base + '/api/ai/status', { headers: { 'X-Easynews-Extension': id, Origin: 'https://evil.test' } })).status, 403);
  const headers = { 'X-Easynews-Extension': id, Origin: `chrome-extension://${id}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/ai/status', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/ai/connect', { method: 'POST', headers, body: JSON.stringify({ token: 'secret' }) })).status, 400);
  const options = await fetch(base + '/api/ai/connect', { method: 'OPTIONS', headers });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('cache-control'), 'no-store');
});
