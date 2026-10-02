// Browser fixture: actual built panel UI, simulated Chrome APIs and local mock AI.
// No API key, news content, file storage or external requests are used.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createApp } from '../../server/dist/app.js';
import { createRelatedService } from '../../server/dist/related.js';
import { createNaverSearch } from '../../server/dist/naver.js';
import { createRelatedLlm } from '../../server/dist/related-llm.js';
import { fallbackFingerprint } from '../../server/dist/news-ranking.js';

const articleQa = (await build({ entryPoints: [new URL('../tests/article-context.browser.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], bundle: true, write: false, format: 'iife' })).outputFiles[0].text;

const dist = new URL('../dist/', import.meta.url);
let mockFlags = { failure: false, empty: false, llmFailure: false, missingConfig: false };
const output = (value) => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const mockApp = createApp({ extensionId: 'a'.repeat(32) }, async () => '테스트 설명', async (input, signal) => {
  const flags = { ...mockFlags };
  const search = createNaverSearch({ clientId: flags.missingConfig ? '' : 'fixture', clientSecret: 'fixture' }, async () => {
    if (flags.failure) return new Response('Fixture failure', { status: 500 });
    const news = (title, path, pubDate) => ({ title, link: `http://127.0.0.1:3101/${path}`, originallink: `http://127.0.0.1:3101/${path}`, description: '<b>합성 검색 metadata</b>', pubDate });
    return Response.json({ items: flags.empty ? [] : [
      news('한국은행 기준금리 동결 이후 채권시장 반응', 'article-b', 'Fri, 02 Oct 2026 11:00:00 +0900'),
      news('한국은행 기준금리 동결 후속 전망 발표', 'article-c', 'Fri, 02 Oct 2026 12:00:00 +0900'),
      news('한국은행 기준금리 결정 이전 물가 지표', 'article-background', 'Thu, 01 Oct 2026 10:00:00 +0900'),
      news('한국은행 기준금리 동결 이후 과거 전망', 'article-old', 'Sun, 20 Sep 2026 10:00:00 +0900'),
      news('한국은행 기준금리 동결 이후 추가 반응', 'article-unknown', 'invalid'),
      news('한국은행 직원 채용 발표', 'article-unrelated', 'Fri, 02 Oct 2026 11:00:00 +0900'),
      { title: input.title, link: input.url, originallink: input.canonicalUrl || input.url, pubDate: input.publishedAt },
    ] });
  });
  const llm = createRelatedLlm({ apiKey: 'fixture-only', model: 'fixture-model' }, async (_url, options) => {
    if (flags.llmFailure) return new Response('Fixture LLM failure', { status: 500 });
    const body = JSON.parse(options.body);
    if (body.text.format.name === 'event_fingerprint') return Response.json(output(fallbackFingerprint(input)));
    const data = JSON.parse(body.input);
    return Response.json(output({ relations: data.candidates.map((candidate) => ({ index: candidate.index, relation: candidate.title.includes('이전') ? 'background' : 'follow_up', relationReason: candidate.title.includes('이전') ? '현재 결정에 앞선 지표와의 관계' : '현재 결정 이후 진행 상황과의 관계' })) }));
  });
  return createRelatedService(search, llm)(input, signal);
});
await new Promise((resolve) => mockApp.listen(0, '127.0.0.1', resolve));
const mockBase = `http://127.0.0.1:${mockApp.address().port}`;
const shim = `
const event = () => { const listeners = []; return { addListener: f => listeners.push(f), emit: (...args) => listeners.forEach(f => f(...args)) }; };
const secondArticle = location.pathname === '/article-b';
let tab = { id: secondArticle ? 2 : 1, url: secondArticle ? location.href : 'https://news.example/fixture' };
const article = { title: secondArticle ? '한국은행 기준금리 동결 이후 채권시장 반응' : '한국은행 기준금리 동결', url: tab.url, canonicalUrl: tab.url, siteName: 'QA 언론사', publishedAt: secondArticle ? '2026-10-02T11:00:00+09:00' : '2026-10-02T10:00:00+09:00', textContent: '한국은행 기준금리 동결과 물가 상황을 확인하는 합성 문장입니다. '.repeat(10), confidence: 'high', extractionMethod: 'readability', surroundingContext: '선택 문장이 포함된 합성 문단입니다.' };
let state = { status: 'ready', page: { title: article.title, url: tab.url, selectedText: '테스트 문장의 뜻을 확인합니다.', truncated: false, article } };
const port = { onDisconnect: event(), disconnect() { this.onDisconnect.emit(); } };
window.chrome = {
  runtime: { id: 'a'.repeat(32), connect: () => port },
  windows: { getCurrent: async () => ({ id: 1 }) },
  tabs: { query: async () => [tab], onActivated: event(), onUpdated: event() },
  storage: { session: { get: async key => ({ [key]: state }) }, onChanged: event() }
};
let failure = false;
let delay = false;
let calls = 0;
let relatedCalls = 0;
let empty = false;
let llmFailure = false;
let missingConfig = false;
const originalFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  if (!['http://127.0.0.1:3000/api/explain', 'http://127.0.0.1:3000/api/related'].includes(url)) throw new Error('Fixture forbids external requests');
  const related = url.endsWith('/related');
  document.getElementById(related ? 'qa-related-calls' : 'qa-calls').textContent = String(related ? ++relatedCalls : ++calls);
  document.getElementById(related ? 'qa-related-fields' : 'qa-fields').textContent = Object.keys(JSON.parse(options.body)).sort().join(',');
  const slow = delay;
  const fixtureOptions = { ...options, headers: { ...options.headers, 'X-QA-Fail': String(failure), 'X-QA-Delay': String(slow), 'X-QA-Empty': String(empty), 'X-QA-Llm-Fail': String(llmFailure), 'X-QA-Config': String(missingConfig) } };
  // Simulate a transport that finishes after abort; the panel must discard it.
  if (slow) { delete fixtureOptions.signal; document.getElementById('qa-flight').textContent = '지연 요청 진행 중'; }
  const response = await originalFetch(related ? '/api/related' : '/api/explain', fixtureOptions);
  if (slow) document.getElementById('qa-flight').textContent = '지연 요청 완료';
  return response;
};
document.addEventListener('DOMContentLoaded', () => {
  const update = () => chrome.storage.onChanged.emit({}, 'session');
  document.getElementById('qa-change').onclick = () => { state = { ...state, page: { ...state.page, selectedText: '새롭게 선택한 테스트 문장입니다.' } }; update(); };
  document.getElementById('qa-navigate').onclick = () => { tab = { ...tab, url: 'https://news.example/next' }; state = undefined; chrome.tabs.onUpdated.emit(tab.id, { url: tab.url }); update(); };
  document.getElementById('qa-long').onclick = () => { state = { status: 'ready', page: { title: 'QA 테스트 기사', url: tab.url, selectedText: '가'.repeat(2001), truncated: false } }; update(); };
  document.getElementById('qa-fail').onclick = e => { failure = !failure; e.target.textContent = failure ? '오류 모드: 켜짐' : '오류 모드: 꺼짐'; };
  document.getElementById('qa-delay').onclick = e => { delay = !delay; e.target.textContent = delay ? '지연 모드: 켜짐' : '지연 모드: 꺼짐'; };
  document.getElementById('qa-close').onclick = () => { window.dispatchEvent(new Event('pagehide')); };
  document.getElementById('qa-empty').onclick = e => { empty = !empty; e.target.textContent = '빈 결과: ' + (empty ? '켜짐' : '꺼짐'); };
  document.getElementById('qa-llm-fail').onclick = e => { llmFailure = !llmFailure; e.target.textContent = 'LLM 실패: ' + (llmFailure ? '켜짐' : '꺼짐'); };
  document.getElementById('qa-config').onclick = e => { missingConfig = !missingConfig; e.target.textContent = '설정 누락: ' + (missingConfig ? '켜짐' : '꺼짐'); };
  document.getElementById('qa-low').onclick = () => { state = { ...state, page: { ...state.page, article: { ...article, confidence: 'low', textContent: undefined } } }; update(); };
});
`;

const controls = `<aside aria-label="QA fixture" style="border:1px dashed #aaa;padding:12px;margin-bottom:20px">
<strong>QA fixture — Chrome API와 AI 응답은 모킹합니다</strong>
<p>요청 수: <span id="qa-calls">0</span> · 입력 필드: <span id="qa-fields"></span></p>
<p>관련 요청 수: <span id="qa-related-calls">0</span> · 입력 필드: <span id="qa-related-fields"></span></p>
<p id="qa-flight"></p>
<button id="qa-change">문장 변경</button><button id="qa-navigate">기사 이동</button><button id="qa-long">긴 선택</button>
<button id="qa-fail">오류 모드: 꺼짐</button><button id="qa-delay">지연 모드: 꺼짐</button><button id="qa-close">패널 종료 이벤트</button>
<button id="qa-empty">빈 결과: 꺼짐</button><button id="qa-llm-fail">LLM 실패: 꺼짐</button><button id="qa-config">설정 누락: 꺼짐</button><button id="qa-low">문맥 부족</button>
</aside>`;

const app = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.url === '/api/related' && request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      if (request.headers['x-qa-delay'] === 'true') await new Promise((resolve) => setTimeout(resolve, 2000));
      mockFlags = { failure: request.headers['x-qa-fail'] === 'true', empty: request.headers['x-qa-empty'] === 'true', llmFailure: request.headers['x-qa-llm-fail'] === 'true', missingConfig: request.headers['x-qa-config'] === 'true' };
      const result = await fetch(mockBase + '/api/related', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Easynews-Extension': 'a'.repeat(32), Origin: 'chrome-extension://' + 'a'.repeat(32) }, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(await result.text());
      return;
    }
    if (request.url === '/article-qa') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="ko"><meta charset="UTF-8"><title>Easynews Article Context QA</title><h1>합성 HTML로 기사 문맥 검증</h1><p>외부 요청·API 키·기사 원문 없이 Chrome 실제 DOM과 Readability를 사용합니다.</p><button>문맥 테스트 실행</button><ul id="qa-results"></ul><script src="article-qa.js"></script></html>');
      return;
    }
    if (request.url === '/article-qa.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(articleQa);
      return;
    }
    if (request.url === '/api/explain' && request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { mode } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const failure = request.headers['x-qa-fail'] === 'true';
      const answer = { simple: '쉽게 설명 테스트 응답', why: '왜 그런가 테스트 응답', background: '<b>배경 설명 테스트 응답</b>' }[mode];
      const finish = () => {
        if (response.destroyed) return;
        response.writeHead(failure ? 429 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(failure ? { error: { code: 'LLM_RATE_LIMIT' } } : { answer }));
      };
      if (request.headers['x-qa-delay'] === 'true') setTimeout(finish, 2000);
      else finish();
      return;
    }
    if (request.url === '/qa-shim.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(shim);
      return;
    }
    const files = { '/': 'sidepanel.html', '/sidepanel.js': 'sidepanel.js', '/sidepanel.css': 'sidepanel.css' };
    const filename = request.url?.startsWith('/article-') ? 'sidepanel.html' : files[request.url];
    if (!filename) { response.writeHead(404); response.end(); return; }
    let content = await readFile(new URL(filename, dist), 'utf8');
    if (filename.endsWith('.html')) content = content.replace('<head>', '<head><script src="qa-shim.js"></script>').replace('<main>', `<main>${controls}`);
    response.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.css') ? 'text/css' : 'text/javascript' });
    response.end(content);
  } catch { response.writeHead(500); response.end('QA fixture error'); }
});
app.listen(3101, '127.0.0.1', () => console.log('Temporary panel UI fixture: http://127.0.0.1:3101'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.close(); app.closeAllConnections(); mockApp.close(); mockApp.closeAllConnections(); });
