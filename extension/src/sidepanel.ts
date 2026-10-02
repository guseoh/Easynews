import { stateKey, type TabState } from './state';

const title = document.querySelector<HTMLHeadingElement>('#page-title')!;
const url = document.querySelector<HTMLAnchorElement>('#page-url')!;
const selected = document.querySelector<HTMLQuoteElement>('#selected-text')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const count = document.querySelector<HTMLParagraphElement>('#selection-count')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
let revision = 0;
let port: chrome.runtime.Port | undefined;
let closed = false;

async function connect() {
  try {
    const window = await chrome.windows.getCurrent();
    if (closed || window.id === undefined) return;
    port = chrome.runtime.connect({ name: `panel:${window.id}` });
    port.onDisconnect.addListener(() => {
      // Reconnect if Chrome suspends the worker while the panel is still visible.
      if (!closed) setTimeout(() => void connect(), 250);
    });
  } catch {
    render({ status: 'error', message: '확장 프로그램을 다시 실행해 주세요.' });
  }
}

window.addEventListener('pagehide', () => { closed = true; port?.disconnect(); });
void connect();

function render(state?: TabState) {
  title.textContent = state?.page?.title || '현재 페이지';
  url.textContent = state?.page?.url || '';
  url.hidden = !state?.page;
  if (state?.page) url.href = state.page.url;
  else url.removeAttribute('href');
  selected.textContent = state?.page?.selectedText || '기사에서 이해하기 어려운 문장을 선택해 주세요.';
  count.textContent = state?.page?.selectedText
    ? `${state.page.selectedText.length.toLocaleString('ko-KR')}자${state.page.truncated ? ' · 긴 선택은 처음 8,000자만 표시합니다.' : ''}` : '';
  status.dataset.state = state?.status || 'idle';
  status.textContent = state?.status === 'loading' ? '페이지 정보를 읽고 있습니다…'
    : state?.status === 'error' ? state.message || '페이지 정보를 읽지 못했습니다.'
    : state?.status === 'ready' ? '문장을 선택하면 여기에 표시됩니다.'
    : '읽고 있는 탭에서 Easynews 확장 아이콘을 눌러 주세요.';
}

async function sync() {
  const request = ++revision;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const key = tab?.id === undefined ? undefined : stateKey(tab.id);
    const data = key ? await chrome.storage.session.get(key) : {};
    if (request !== revision) return;
    const state = key ? data[key] as TabState | undefined : undefined;
    // A stored selection must never be displayed for a different page.
    render(state?.page && state.page.url !== tab?.url ? undefined : state);
  } catch {
    if (request === revision) render({ status: 'error', message: '상태를 확인하지 못했습니다. 다시 확인을 눌러 주세요.' });
  }
}

refresh.addEventListener('click', () => void sync());
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'session') void sync();
});
chrome.tabs.onActivated.addListener(() => void sync());
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.status || change.url) void sync();
});
void sync();
