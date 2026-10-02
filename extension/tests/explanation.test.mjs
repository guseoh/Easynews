import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/explanation.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
function load() {
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, chrome: { runtime: { id: 'test-extension' } }, AbortController });
  return module.exports;
}

test('explain request sends only mode, selected text and bounded title without caching', async () => {
  const { requestExplanation } = load();
  let captured;
  const response = await requestExplanation('why', { title: '가'.repeat(350), selectedText: '선택 문장', url: 'https://news.example', content: 'entire article' }, new AbortController().signal, async (url, options) => {
    captured = { url, options };
    return Response.json({ answer: '설명' });
  });
  assert.equal(response, '설명');
  assert.equal(captured.url, 'http://127.0.0.1:3000/api/explain');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.headers['X-Easynews-Extension'], 'test-extension');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['articleTitle', 'mode', 'selectedText']);
  assert.equal(body.articleTitle.length, 300);
});

test('oversized input and invalid server responses are rejected; upstream text is not displayed', async () => {
  const { requestExplanation } = load();
  let calls = 0;
  const signal = new AbortController().signal;
  await assert.rejects(requestExplanation('simple', { title: '', selectedText: '가'.repeat(2_001) }, signal, async () => { calls++; return Response.json({ answer: '설명' }); }));
  assert.equal(calls, 0);
  for (const data of [{}, { answer: 42 }, { answer: '' }, { answer: '가'.repeat(8_001) }]) {
    await assert.rejects(requestExplanation('simple', { title: '', selectedText: '문장' }, signal, async () => Response.json(data)));
  }
  await assert.rejects(requestExplanation('simple', { title: '', selectedText: '문장' }, signal, async () => new Response('private invalid response')), /서버 응답을 읽지 못했습니다/);
  await assert.rejects(requestExplanation('simple', { title: '', selectedText: '문장' }, signal, async () => Response.json({ error: { code: 'LLM_RATE_LIMIT', message: 'private provider data' } }, { status: 429 })), /요청 한도/);
});

test('invalidation aborts and discards an answer that arrives after a selection or page change', async () => {
  const { ExplanationSession } = load();
  const session = new ExplanationSession();
  let release;
  let signal;
  const old = session.run((requestSignal) => { signal = requestSignal; return new Promise((resolve) => { release = resolve; }); });
  session.invalidate();
  assert.equal(signal.aborted, true);
  release('old answer');
  assert.equal(await old, undefined);
  assert.equal(await session.run(async () => 'new answer'), 'new answer');
});

test('starting another mode cancels the previous mode and ignores its late error', async () => {
  const { ExplanationSession } = load();
  const session = new ExplanationSession();
  let fail;
  const old = session.run(() => new Promise((_resolve, reject) => { fail = reject; }));
  assert.equal(await session.run(async () => '배경 설명'), '배경 설명');
  fail(new Error('old error'));
  assert.equal(await old, undefined);
});
