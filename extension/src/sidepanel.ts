import { stateKey, type TabState } from './state';
import { ExplanationSession, MAX_EXPLAIN_SELECTION, requestExplanation, type ExplainMode } from './explanation';

const title = document.querySelector<HTMLHeadingElement>('#page-title')!;
const url = document.querySelector<HTMLAnchorElement>('#page-url')!;
const selected = document.querySelector<HTMLQuoteElement>('#selected-text')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const count = document.querySelector<HTMLParagraphElement>('#selection-count')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const explainButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
const answer = document.querySelector<HTMLParagraphElement>('#answer')!;
const explainStatus = document.querySelector<HTMLParagraphElement>('#explain-status')!;
const retry = document.querySelector<HTMLButtonElement>('#retry-explain')!;
const contextStatus = document.querySelector<HTMLParagraphElement>('#context-status')!;
const explanation = new ExplanationSession();
let currentState: TabState | undefined;
let currentKey = '';
let busy = false;
let lastMode: ExplainMode | undefined;
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

window.addEventListener('pagehide', () => { closed = true; clearExplanation(); port?.disconnect(); });
void connect();

function canExplain() {
  const text = currentState?.page?.selectedText || '';
  return currentState?.status === 'ready' && !!text.trim() && text.length <= MAX_EXPLAIN_SELECTION;
}

function updateButtons() {
  for (const button of explainButtons) button.disabled = busy || !canExplain();
  retry.disabled = busy || !canExplain();
}

function clearExplanation() {
  explanation.invalidate();
  busy = false;
  lastMode = undefined;
  answer.textContent = '';
  explainStatus.textContent = '';
  retry.hidden = true;
}

function render(state?: TabState, key = '') {
  if (key !== currentKey || state?.page?.url !== currentState?.page?.url
    || state?.page?.title !== currentState?.page?.title || state?.page?.selectedText !== currentState?.page?.selectedText) {
    clearExplanation();
  }
  currentKey = key;
  currentState = state;
  title.textContent = state?.page?.title || '현재 페이지';
  url.textContent = state?.page?.url || '';
  url.hidden = !state?.page;
  if (state?.page) url.href = state.page.url;
  else url.removeAttribute('href');
  selected.textContent = state?.page?.selectedText || '기사에서 이해하기 어려운 문장을 선택해 주세요.';
  count.textContent = state?.page?.selectedText
    ? `${state.page.selectedText.length.toLocaleString('ko-KR')}자${state.page.truncated ? ' · 긴 선택은 처음 8,000자만 표시합니다.' : ''}` : '';
  status.dataset.state = state?.status || 'idle';
  contextStatus.textContent = state?.page?.article?.confidence === 'low' ? '기사 문맥을 충분히 추출하지 못했습니다. 선택 문장만으로 설명할 수 있습니다.'
    : state?.page?.article ? '기사 문맥을 확인했습니다. 설명에는 필요한 짧은 주변 문맥만 사용합니다.' : '';
  status.textContent = state?.status === 'loading' ? '페이지 정보를 읽고 있습니다…'
    : state?.status === 'error' ? state.message || '페이지 정보를 읽지 못했습니다.'
    : state?.status === 'ready' ? '문장을 선택하면 여기에 표시됩니다.'
    : '읽고 있는 탭에서 Easynews 확장 아이콘을 눌러 주세요.';
  if ((state?.page?.selectedText.length || 0) > MAX_EXPLAIN_SELECTION) {
    explainStatus.textContent = 'AI 설명은 2,000자까지 가능합니다. 설명할 부분만 짧게 선택해 주세요.';
  }
  updateButtons();
}

async function explain(mode: ExplainMode) {
  if (closed || busy || !canExplain() || !currentState?.page) return;
  const selection = { title: currentState.page.title, selectedText: currentState.page.selectedText, surroundingContext: currentState.page.article?.surroundingContext };
  busy = true;
  lastMode = mode;
  retry.hidden = true;
  answer.textContent = '';
  explainStatus.textContent = '선택한 문장을 설명하고 있습니다…';
  updateButtons();
  try {
    const result = await explanation.run((signal) => requestExplanation(mode, selection, AbortSignal.any([signal, AbortSignal.timeout(40_000)])));
    if (result === undefined) return;
    busy = false;
    answer.textContent = result;
    explainStatus.textContent = 'AI 설명입니다. 기사 원문과 함께 확인해 주세요.';
    updateButtons();
  } catch (error) {
    busy = false;
    explainStatus.textContent = error instanceof TypeError ? '로컬 서버에 연결하지 못했습니다. 서버 실행 후 다시 시도해 주세요.'
      : error instanceof DOMException && error.name === 'TimeoutError' ? '응답 시간이 초과됐습니다. 다시 시도해 주세요.'
      : error instanceof Error ? error.message : '설명을 가져오지 못했습니다. 다시 시도해 주세요.';
    retry.hidden = false;
    updateButtons();
  }
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
    render(state?.page && state.page.url !== tab?.url ? undefined : state, key);
  } catch {
    if (request === revision) render({ status: 'error', message: '상태를 확인하지 못했습니다. 다시 확인을 눌러 주세요.' });
  }
}

refresh.addEventListener('click', () => void sync());
for (const button of explainButtons) button.addEventListener('click', () => void explain(button.dataset.mode as ExplainMode));
retry.addEventListener('click', () => { if (lastMode) void explain(lastMode); });
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'session') void sync();
});
chrome.tabs.onActivated.addListener(() => { clearExplanation(); currentState = undefined; updateButtons(); void sync(); });
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.status || change.url) {
    if (currentKey === stateKey(_tabId) && (change.status === 'loading' || change.url)) {
      clearExplanation(); currentState = undefined; updateButtons();
    }
    void sync();
  }
});
void sync();
