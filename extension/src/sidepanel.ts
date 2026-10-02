import { stateKey, type TabState } from './state';
import { ExplanationSession, MAX_EXPLAIN_SELECTION, requestExplanation, type ExplainMode } from './explanation';
import { requestRelated, WARNING_MESSAGES, type RelatedArticle } from './related-news';

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
const relatedButton = document.querySelector<HTMLButtonElement>('#find-related')!;
const relatedStatus = document.querySelector<HTMLParagraphElement>('#related-status')!;
const relatedRetry = document.querySelector<HTMLButtonElement>('#retry-related')!;
const followUps = document.querySelector<HTMLOListElement>('#follow-ups')!;
const backgroundNews = document.querySelector<HTMLOListElement>('#background-news')!;
const explanation = new ExplanationSession();
const relatedSession = new ExplanationSession();
let relatedBusy = false;
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

window.addEventListener('pagehide', () => { closed = true; revision++; render(); port?.disconnect(); });
void connect();

function canExplain() {
  const text = currentState?.page?.selectedText || '';
  return currentState?.status === 'ready' && !!text.trim() && text.length <= MAX_EXPLAIN_SELECTION;
}

function updateButtons() {
  for (const button of explainButtons) button.disabled = busy || !canExplain();
  retry.disabled = busy || !canExplain();
  const article = currentState?.page?.article;
  const canRelate = currentState?.status === 'ready' && article?.confidence !== 'low' && (article?.textContent?.trim().length || 0) >= 80;
  relatedButton.disabled = relatedBusy || !canRelate;
  relatedRetry.disabled = relatedBusy || !canRelate;
}

function clearExplanation() {
  explanation.invalidate();
  busy = false;
  lastMode = undefined;
  answer.textContent = '';
  explainStatus.textContent = '';
  retry.hidden = true;
}

function clearRelated() {
  relatedSession.invalidate();
  relatedBusy = false;
  relatedStatus.textContent = '';
  relatedRetry.hidden = true;
  followUps.replaceChildren();
  backgroundNews.replaceChildren();
}

function renderNews(list: HTMLOListElement, articles: RelatedArticle[]) {
  list.replaceChildren();
  for (const article of articles) {
    const item = document.createElement('li');
    const heading = document.createElement('h4'); heading.textContent = article.title;
    const metadata = document.createElement('p'); metadata.className = 'caption';
    const date = article.publishedAt ? new Date(article.publishedAt) : undefined;
    metadata.textContent = `${article.source} · ${date && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '날짜 미확인'}`;
    const reason = document.createElement('p'); reason.textContent = article.relationReason;
    const link = document.createElement('a'); link.textContent = '원문 읽기'; link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    item.append(heading, metadata, reason, link); list.append(item);
  }
}

async function findRelated() {
  const article = currentState?.page?.article;
  if (closed || relatedBusy || relatedButton.disabled || !article) return;
  relatedBusy = true; relatedRetry.hidden = true;
  followUps.replaceChildren(); backgroundNews.replaceChildren();
  relatedStatus.textContent = '이어지는 기사와 배경 기사를 찾고 있습니다…'; updateButtons();
  try {
    const result = await relatedSession.run((signal) => requestRelated(article, AbortSignal.any([signal, AbortSignal.timeout(45_000)])));
    if (result === undefined) return;
    relatedBusy = false;
    renderNews(followUps, result.followUps); renderNews(backgroundNews, result.background);
    const message = result.followUps.length || result.background.length ? '제목과 관계를 확인하고 언론사 원문에서 읽어 주세요.' : '확인할 수 있는 후속·배경 기사가 없습니다. 관련도가 낮은 기사로 채우지 않습니다.';
    relatedStatus.textContent = [message, ...result.warnings.map((warning) => WARNING_MESSAGES[warning])].join(' ');
    updateButtons();
  } catch (error) {
    relatedBusy = false;
    relatedStatus.textContent = error instanceof TypeError ? '로컬 서버에 연결하지 못했습니다. 서버 실행 후 다시 시도해 주세요.'
      : error instanceof DOMException && error.name === 'TimeoutError' ? '관련 뉴스 요청 시간이 초과됐습니다. 다시 시도해 주세요.'
      : error instanceof Error ? error.message : '관련 뉴스를 가져오지 못했습니다.';
    relatedRetry.hidden = false; updateButtons();
  }
}

function render(state?: TabState, key = '') {
  if (key !== currentKey || state?.page?.url !== currentState?.page?.url || state?.page?.title !== currentState?.page?.title
    || state?.page?.article?.canonicalUrl !== currentState?.page?.article?.canonicalUrl
    || state?.page?.article?.publishedAt !== currentState?.page?.article?.publishedAt
    || state?.page?.article?.textContent !== currentState?.page?.article?.textContent) clearRelated();
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
  const selection = { title: currentState.page.title, selectedText: currentState.page.selectedText,
    surroundingContext: currentState.page.article?.confidence === 'low' ? undefined : currentState.page.article?.surroundingContext };
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
    if (request !== revision || closed) return;
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
relatedButton.addEventListener('click', () => void findRelated());
relatedRetry.addEventListener('click', () => void findRelated());
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'session') void sync();
});
chrome.tabs.onActivated.addListener(() => { render(); void sync(); });
chrome.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.status || change.url) {
    if (currentKey === stateKey(_tabId) && (change.status === 'loading' || change.url)) {
      render();
    }
    void sync();
  }
});
void sync();
