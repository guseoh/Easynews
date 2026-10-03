import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { ApiError, createPrompt, parseAnswer, validateInput } from '../dist/explain.js';
import { createExplainer } from '../dist/openai.js';

const extensionId = 'a'.repeat(32);
const origin = `chrome-extension://${extensionId}`;
const input = { mode: 'simple', selectedText: '테스트 문장', articleTitle: '테스트 제목' };
const headers = { 'Content-Type': 'application/json', 'X-Easynews-Extension': extensionId, Origin: origin };
const output = (text = '테스트 설명') => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

async function start(t, explain, id = extensionId) {
  const app = createApp({ extensionId: id }, explain);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections(); }));
  const url = `http://127.0.0.1:${app.address().port}`;
  return {
    url,
    post: (body = input, options = {}) => fetch(`${url}/api/explain`, { method: 'POST', headers, body: JSON.stringify(body), ...options }),
  };
}

test('all three modes travel through the HTTP API and use stateless minimal provider requests', async (t) => {
  const calls = [];
  const provider = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json(output());
  };
  const { post } = await start(t, createExplainer({ apiKey: 'test-key', model: 'test-model' }, provider));
  for (const mode of ['simple', 'why', 'background']) {
    const response = await post({ ...input, mode });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.deepEqual(await response.json(), { answer: '테스트 설명' });
  }
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => call.body.instructions)).size, 3);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.openai.com/v1/responses');
    assert.equal(call.body.store, false);
    assert.equal(call.body.model, 'test-model');
    assert.equal(call.body.previous_response_id, undefined);
    assert.equal(call.body.tools, undefined);
    assert.deepEqual(JSON.parse(call.body.input), { articleTitle: input.articleTitle, selectedText: input.selectedText });
  }
});

test('streaming transport exposes drafts then a verified completion and safe errors', async (t) => {
  const { post } = await start(t, async (_input, _signal, onDelta) => { onDelta?.('첫 문단'); return '첫 문단\n\n두 번째 문단'; });
  const response = await post(input, { headers: { ...headers, Accept: 'application/x-ndjson' } });
  assert.match(response.headers.get('content-type'), /ndjson/);
  assert.deepEqual((await response.text()).trim().split('\n').map(JSON.parse), [{ delta: '첫 문단' }, { answer: '첫 문단\n\n두 번째 문단' }]);
  const failing = await start(t, async (_input, _signal, onDelta) => { onDelta?.('임시'); throw new Error('private upstream'); });
  const failed = await failing.post(input, { headers: { ...headers, Accept: 'application/x-ndjson' } });
  const events = (await failed.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[1].error.code, 'SERVER_ERROR');
  assert.ok(!JSON.stringify(events).includes('private upstream'));
  assert.ok(!events.some((event) => 'answer' in event));
});

test('API Key streaming requires response.completed, preserves UTF-8 and remains stateless', async () => {
  const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const text = event({ type: 'response.output_text.delta', delta: '한국어' }) + event({ type: 'response.completed', response: output('한국어') });
  const bytes = new TextEncoder().encode(text);
  const drafts = [];
  const explain = createExplainer({ apiKey: 'test', model: 'test' }, async (_url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.stream, true); assert.equal(body.store, false);
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
  });
  assert.equal(await explain(input, new AbortController().signal, (delta) => drafts.push(delta)), '한국어');
  assert.deepEqual(drafts, ['한국어']);
  const incomplete = createExplainer({ apiKey: 'test', model: 'test' }, async () => new Response(event({ type: 'response.output_text.delta', delta: '미완료' })));
  await assert.rejects(incomplete(input, new AbortController().signal, () => {}), (error) => error.code === 'INVALID_LLM_RESPONSE');
});

test('schema rejects article bodies, unknown fields and invalid or oversized selections before LLM', async (t) => {
  let calls = 0;
  const { post } = await start(t, async () => { calls++; return '응답'; });
  for (const body of [null, [], { ...input, mode: 'summary' }, { ...input, selectedText: ' ' },
    { ...input, selectedText: '가'.repeat(2_001) }, { ...input, articleTitle: '가'.repeat(301) },
    { ...input, articleContext: '전체 기사' }, { ...input, content: '전체 기사' }, { ...input, url: 'https://news.example' }]) {
    const response = await post(body);
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  assert.equal(validateInput({ mode: 'simple', selectedText: ' 문장 ' }).selectedText, '문장');
});

test('focused explanation and questions are bounded to current selection without response history', () => {
  const value = validateInput({ ...input, selectedText: '공실률 4.0%로 상승', focusText: '4.0%', question: '이 수치가 의미하는 것은?', depth: 'detailed' });
  const prompt = createPrompt(value);
  assert.equal(JSON.parse(prompt.input).focusText, '4.0%');
  assert.equal(JSON.parse(prompt.input).question, '이 수치가 의미하는 것은?');
  assert.match(prompt.instructions, /최대 10문장/);
  for (const extra of [{ focusText: '발췌에 없는 용어' }, { question: '가'.repeat(301) }, { depth: 'unbounded' }, { history: ['old answer'] }, { previousAnswer: 'old answer' }]) {
    assert.throws(() => validateInput({ ...input, ...extra }), (error) => error.code === 'INVALID_INPUT');
  }
});

test('only configured extension can call explain; preflight is narrow', async (t) => {
  const { post, url } = await start(t, async () => '응답');
  assert.equal((await post(input, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(input, { headers: { ...headers, 'X-Easynews-Extension': 'b'.repeat(32) } })).status, 403);
  assert.equal((await post(input, { headers: { 'Content-Type': 'application/json' } })).status, 403);
  const preflight = await fetch(`${url}/api/explain`, { method: 'OPTIONS', headers: { Origin: origin } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST');
});

test('explanation accepts only bounded optional surrounding context and keeps it untrusted', async (t) => {
  let prompt;
  const { post } = await start(t, createExplainer({ apiKey: 'test', model: 'test' }, async (_url, options) => {
    prompt = JSON.parse(options.body);
    return Response.json(output());
  }));
  assert.equal((await post({ ...input, surroundingContext: '선택 문장 주변 문단' })).status, 200);
  assert.equal(JSON.parse(prompt.input).surroundingContext, '선택 문장 주변 문단');
  assert.equal(prompt.store, false);
  assert.match(prompt.instructions, /주변 문맥.*신뢰하지 않는 데이터/);
  assert.equal((await post({ ...input, surroundingContext: '가'.repeat(1601) })).status, 400);
  assert.equal((await post({ ...input, surroundingContext: 123 })).status, 400);
  assert.equal((await post({ ...input, textContent: 'whole article' })).status, 400);
});

test('malformed JSON, unsupported content types and oversized bodies fail safely', async (t) => {
  const { post } = await start(t, async () => '응답');
  assert.equal((await post(input, { body: '{' })).status, 400);
  assert.equal((await post(input, { headers: { ...headers, 'Content-Type': 'text/plain' } })).status, 415);
  const large = await post({ ...input, selectedText: '가'.repeat(20_000) });
  assert.equal(large.status, 413);
});

test('missing configuration and provider errors give safe retryable responses', async (t) => {
  const unconfigured = await start(t, createExplainer({ apiKey: '', model: 'test' }));
  assert.equal((await unconfigured.post()).status, 503);
  const missingId = await start(t, async () => '응답', '');
  assert.equal((await missingId.post()).status, 503);
  for (const [providerStatus, expectedStatus, code] of [[429, 429, 'LLM_RATE_LIMIT'], [401, 503, 'LLM_CONFIGURATION_ERROR'], [500, 502, 'LLM_FAILED']]) {
    const { post } = await start(t, createExplainer({ apiKey: 'test-key', model: 'test' }, async () => new Response('private provider body', { status: providerStatus })));
    const response = await post();
    assert.equal(response.status, expectedStatus);
    const data = await response.json();
    assert.equal(data.error.code, code);
    assert.ok(!JSON.stringify(data).includes('private provider body'));
  }
});

test('invalid, incomplete or refused LLM output is rejected rather than shown', () => {
  for (const value of [null, {}, { ...output(), status: 'incomplete' }, output(''), output('가'.repeat(8_001)), { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 123 }] }] }]) {
    assert.throws(() => parseAnswer(value), (error) => error instanceof ApiError && error.status === 502);
  }
  assert.throws(() => parseAnswer({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), (error) => error.status === 422);
  assert.match(createPrompt(input).instructions, /信頼|신뢰하지 않는 데이터/);
});

test('provider timeouts and user cancellation propagate without storing request state', async () => {
  const pendingFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('late')), 100);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  const explain = createExplainer({ apiKey: 'test', model: 'test', timeoutMs: 5 }, pendingFetch);
  await assert.rejects(explain(input, new AbortController().signal), (error) => error.code === 'LLM_TIMEOUT');
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(explain(input, cancelled.signal), (error) => error.code === 'REQUEST_CANCELLED');
});

test('connection closure aborts an in-flight provider request', async (t) => {
  let started;
  let aborted;
  const startSignal = new Promise((resolve) => { started = resolve; });
  const abortSignal = new Promise((resolve) => { aborted = resolve; });
  const { post } = await start(t, async (_input, signal) => {
    started();
    await new Promise((resolve) => signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
    return '취소된 응답';
  });
  const controller = new AbortController();
  const request = post(input, { signal: controller.signal }).catch(() => undefined);
  await startSignal;
  controller.abort();
  await abortSignal;
  await request;
});

test('concurrency is bounded and requests can resume after completion', async (t) => {
  const releases = [];
  const { post } = await start(t, () => new Promise((resolve) => releases.push(resolve)));
  const first = post();
  const second = post();
  while (releases.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await post()).status, 429);
  releases.splice(0).forEach((resolve) => resolve('응답'));
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  const next = post();
  while (!releases.length) await new Promise((resolve) => setTimeout(resolve, 5));
  releases[0]('다음 응답');
  assert.equal((await next).status, 200);
});
