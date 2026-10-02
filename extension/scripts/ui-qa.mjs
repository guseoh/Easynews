// Browser fixture: actual built panel UI, simulated Chrome APIs and local mock AI.
// No API key, news content, file storage or external requests are used.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const shim = `
const event = () => { const listeners = []; return { addListener: f => listeners.push(f), emit: (...args) => listeners.forEach(f => f(...args)) }; };
let tab = { id: 1, url: 'https://news.example/fixture' };
let state = { status: 'ready', page: { title: 'QA 테스트 기사', url: tab.url, selectedText: '테스트 문장의 뜻을 확인합니다.', truncated: false } };
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
const originalFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  if (url !== 'http://127.0.0.1:3000/api/explain') throw new Error('Fixture forbids external requests');
  document.getElementById('qa-calls').textContent = String(++calls);
  document.getElementById('qa-fields').textContent = Object.keys(JSON.parse(options.body)).sort().join(',');
  const slow = delay;
  const fixtureOptions = { ...options, headers: { ...options.headers, 'X-QA-Fail': String(failure), 'X-QA-Delay': String(slow) } };
  // Simulate a transport that finishes after abort; the panel must discard it.
  if (slow) { delete fixtureOptions.signal; document.getElementById('qa-flight').textContent = '지연 요청 진행 중'; }
  const response = await originalFetch('/api/explain', fixtureOptions);
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
});
`;

const controls = `<aside aria-label="QA fixture" style="border:1px dashed #aaa;padding:12px;margin-bottom:20px">
<strong>QA fixture — Chrome API와 AI 응답은 모킹합니다</strong>
<p>요청 수: <span id="qa-calls">0</span> · 입력 필드: <span id="qa-fields"></span></p>
<p id="qa-flight"></p>
<button id="qa-change">문장 변경</button><button id="qa-navigate">기사 이동</button><button id="qa-long">긴 선택</button>
<button id="qa-fail">오류 모드: 꺼짐</button><button id="qa-delay">지연 모드: 꺼짐</button><button id="qa-close">패널 종료 이벤트</button>
</aside>`;

const app = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
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
    const filename = files[request.url];
    if (!filename) { response.writeHead(404); response.end(); return; }
    let content = await readFile(new URL(filename, dist), 'utf8');
    if (filename.endsWith('.html')) content = content.replace('<head>', '<head><script src="qa-shim.js"></script>').replace('<main>', `<main>${controls}`);
    response.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.css') ? 'text/css' : 'text/javascript' });
    response.end(content);
  } catch { response.writeHead(500); response.end('QA fixture error'); }
});
app.listen(3101, '127.0.0.1', () => console.log('Temporary panel UI fixture: http://127.0.0.1:3101'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.close(); app.closeAllConnections(); });
