import { stateKey, type TabState } from './state';
import { ExplanationSession, MAX_EXPLAIN_SELECTION, requestExplanation, type ExplainMode } from './explanation';
import { requestRelated, WARNING_MESSAGES, type RelatedArticle } from './related-news';
import { mountChatGPTConnection, type AiStatus } from './chatgpt-connection';
import { nextTabIndex, relatedGroupState, resolveTheme, themePreference as parseThemePreference, type ThemePreference } from './sidepanel-view';

const title = document.querySelector<HTMLHeadingElement>('#page-title')!;
const url = document.querySelector<HTMLAnchorElement>('#page-url')!;
const source = document.querySelector<HTMLSpanElement>('#article-source')!;
const connectionMenu = document.querySelector<HTMLDetailsElement>('#connection-menu')!;
const connectionLabel = document.querySelector<HTMLSpanElement>('#connection-label')!;
const connectionDot = document.querySelector<HTMLSpanElement>('#connection-dot')!;
const selected = document.querySelector<HTMLQuoteElement>('#selected-text')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const count = document.querySelector<HTMLParagraphElement>('#selection-count')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const explainButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
const answer = document.querySelector<HTMLParagraphElement>('#answer')!;
const answerCard = document.querySelector<HTMLElement>('#answer-card')!;
const answerTitle = document.querySelector<HTMLHeadingElement>('#answer-title')!;
const explainStatus = document.querySelector<HTMLParagraphElement>('#explain-status')!;
const retry = document.querySelector<HTMLButtonElement>('#retry-explain')!;
const contextStatus = document.querySelector<HTMLParagraphElement>('#context-status')!;
const relatedButton = document.querySelector<HTMLButtonElement>('#find-related')!;
const relatedStatus = document.querySelector<HTMLParagraphElement>('#related-status')!;
const relatedRetry = document.querySelector<HTMLButtonElement>('#retry-related')!;
const followUps = document.querySelector<HTMLOListElement>('#follow-ups')!;
const backgroundNews = document.querySelector<HTMLOListElement>('#background-news')!;
const followUpsCount = document.querySelector<HTMLSpanElement>('#follow-ups-count')!;
const backgroundCount = document.querySelector<HTMLSpanElement>('#background-count')!;
const followUpsEmpty = document.querySelector<HTMLParagraphElement>('#follow-ups-empty')!;
const backgroundEmpty = document.querySelector<HTMLParagraphElement>('#background-empty')!;
const relatedEmpty = document.querySelector<HTMLDivElement>('#related-empty')!;
const relatedResults = document.querySelector<HTMLDivElement>('#related-results')!;
const relatedWaitNote = document.querySelector<HTMLParagraphElement>('#related-wait-note')!;
const relatedProgress = document.querySelector<HTMLOListElement>('#related-progress')!;
const selectionContext = document.querySelector<HTMLSpanElement>('#selection-context')!;
const expandSelection = document.querySelector<HTMLButtonElement>('#expand-selection')!;
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const themeMenu = document.querySelector<HTMLDivElement>('#theme-menu')!;
const themeChoices = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'));
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_KEY = 'easynewsTheme';
let themePreference: ThemePreference = 'system';
let previousConnectionState = '';
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
let aiEnabled = true;
const aiConnection = mountChatGPTConnection((enabled, invalidate, next) => {
  aiEnabled = enabled;
  if (invalidate) { clearExplanation(); clearRelated(); }
  updateConnectionIndicator(next, enabled);
  if (next?.provider === 'chatgpt-plan' && previousConnectionState === '' && (next.status === 'disconnected' || next.status === 'reauth_required')) connectionMenu.open = true;
  if (previousConnectionState === 'connecting' && next?.status === 'connected' && enabled) connectionMenu.open = false;
  previousConnectionState = next?.status || 'error';
  updateButtons();
});

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

function updateConnectionIndicator(status: AiStatus | undefined, enabled: boolean) {
  if (!status) {
    connectionLabel.textContent = '연결 확인 필요';
    connectionDot.dataset.state = 'error';
    return;
  }
  const plan = status.provider === 'chatgpt-plan';
  connectionLabel.textContent = !plan ? 'API Key' : status.status === 'connecting' ? '연결 중'
    : enabled ? 'ChatGPT' : status.status === 'disconnected' ? '연결 필요' : '승인 필요';
  connectionDot.dataset.state = status.status === 'connecting' ? 'connecting'
    : enabled || !plan ? 'connected' : status.status === 'reauth_required' || status.usageLimited ? 'error' : '';
}

function setActiveTab(index: number, focus = false) {
  tabButtons.forEach((tab, position) => {
    const active = position === index;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
    if (panel) panel.hidden = !active;
  });
  if (focus) tabButtons[index]?.focus();
}

function setTheme(preference: ThemePreference, persist = false) {
  themePreference = preference;
  const effective = resolveTheme(preference, systemTheme.matches);
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.themePreference = preference;
  themeChoices.forEach((choice) => choice.setAttribute('aria-checked', String(choice.dataset.themeChoice === preference)));
  themeToggle.setAttribute('aria-label', `테마 선택: ${preference === 'system' ? '시스템 설정' : preference === 'light' ? '라이트' : '다크'}`);
  themeToggle.title = preference === 'system' ? '테마: 시스템 설정' : `테마: ${preference === 'light' ? '라이트' : '다크'}`;
  if (persist) void chrome.storage.local.set({ [THEME_KEY]: preference }).catch(() => undefined);
}

async function loadTheme() {
  try {
    const value = (await chrome.storage.local.get(THEME_KEY))[THEME_KEY];
    setTheme(parseThemePreference(value));
  } catch { setTheme('system'); }
}

function updateRelatedProgress(stage: string, complete = false) {
  const order = ['searching', 'checking', 'classifying'];
  const active = order.indexOf(stage);
  for (const [index, item] of Array.from(relatedProgress.children).entries()) {
    const element = item as HTMLLIElement;
    const state = complete || index < active ? 'complete' : index === active ? 'active' : 'pending';
    element.dataset.state = state;
    if (state === 'active') element.setAttribute('aria-current', 'step');
    else element.removeAttribute('aria-current');
  }
}

function updateButtons() {
  const labels: Record<ExplainMode, string> = { simple: '쉽게 설명', why: '왜 그런가', background: '배경 설명' };
  for (const button of explainButtons) {
    button.disabled = busy || !canExplain() || !aiEnabled;
    button.textContent = busy && button.dataset.mode === lastMode ? `● ${labels[lastMode!]!} 중` : labels[button.dataset.mode as ExplainMode] || '';
  }
  retry.disabled = busy || !canExplain() || !aiEnabled;
  const article = currentState?.page?.article;
  const canRelate = currentState?.status === 'ready' && article?.confidence !== 'low' && (article?.textContent?.trim().length || 0) >= 80;
  relatedButton.disabled = relatedBusy || !canRelate || !aiEnabled;
  relatedRetry.disabled = relatedBusy || !canRelate || !aiEnabled;
}

function clearExplanation() {
  explanation.invalidate();
  busy = false;
  lastMode = undefined;
  answer.textContent = '';
  answerCard.hidden = true;
  explainButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  expandSelection.setAttribute('aria-expanded', 'false');
  expandSelection.textContent = '더 보기';
  explainStatus.textContent = '';
  retry.hidden = true;
}

function clearRelated() {
  relatedSession.invalidate();
  relatedBusy = false;
  relatedStatus.textContent = '';
  relatedRetry.hidden = true;
  relatedStatus.dataset.state = '';
  relatedStatus.dataset.loading = 'false';
  relatedWaitNote.hidden = true;
  relatedProgress.hidden = true;
  relatedEmpty.hidden = true;
  relatedResults.hidden = true;
  followUps.replaceChildren();
  backgroundNews.replaceChildren();
}

function renderNews(list: HTMLOListElement, articles: RelatedArticle[]) {
  list.replaceChildren();
  for (const article of articles) {
    const item = document.createElement('li');
    const card = document.createElement('article'); card.className = 'news-card';
    const heading = document.createElement('h4'); heading.textContent = article.title;
    const metadata = document.createElement('p'); metadata.className = 'news-meta';
    const date = article.publishedAt ? new Date(article.publishedAt) : undefined;
    metadata.textContent = `${article.source} · ${date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '날짜 미확인'}`;
    const reason = document.createElement('p'); reason.className = 'news-reason'; reason.textContent = article.relationReason;
    const link = document.createElement('a'); link.className = 'news-link'; link.textContent = '언론사 원문 읽기 ↗'; link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `언론사 원문: ${article.title} (새 탭에서 열림)`);
    card.append(heading, metadata, reason, link); item.append(card); list.append(item);
  }
}

async function findRelated() {
  const article = currentState?.page?.article;
  if (closed || relatedBusy || relatedButton.disabled || !article) return;
  relatedBusy = true; relatedRetry.hidden = true; relatedEmpty.hidden = true; relatedResults.hidden = true;
  followUps.replaceChildren(); backgroundNews.replaceChildren();
  relatedStatus.textContent = '관련 기사를 찾고 있어요'; relatedStatus.dataset.state = 'loading'; relatedStatus.dataset.loading = 'true';
  relatedWaitNote.hidden = false; relatedProgress.hidden = false; updateRelatedProgress('searching'); updateButtons();
  try {
    const result = await relatedSession.run((signal) => requestRelated(article, AbortSignal.any([signal, AbortSignal.timeout(135_000)]), undefined,
      (stage) => {
        if (!closed && !signal.aborted) {
          relatedStatus.textContent = '관련 기사를 찾고 있어요';
          relatedStatus.dataset.loading = 'true';
          updateRelatedProgress(stage);
        }
      }));
    if (result === undefined) return;
    relatedBusy = false;
    renderNews(followUps, result.followUps); renderNews(backgroundNews, result.background);
    relatedStatus.dataset.state = 'success'; relatedStatus.dataset.loading = 'false';
    relatedWaitNote.hidden = true; updateRelatedProgress('classifying', true);
    const completionMessage = result.followUps.length || result.background.length ? '제목과 관계를 확인했어요. 원문에서 내용을 확인해 주세요.' : '검색이 완료됐습니다.';
    relatedStatus.textContent = [completionMessage, ...result.warnings.map((warning) => WARNING_MESSAGES[warning])].join(' ');
    const groups = relatedGroupState(result.followUps.length, result.background.length);
    relatedResults.hidden = groups.showCombinedEmpty;
    relatedEmpty.hidden = !groups.showCombinedEmpty;
    followUpsEmpty.hidden = !groups.showFollowUpEmpty;
    backgroundEmpty.hidden = !groups.showBackgroundEmpty;
    followUpsCount.textContent = String(result.followUps.length);
    backgroundCount.textContent = String(result.background.length);
    updateButtons();
  } catch (error) {
    relatedBusy = false;
    relatedStatus.dataset.state = 'error'; relatedStatus.dataset.loading = 'false';
    relatedWaitNote.hidden = true; relatedProgress.hidden = true;
    relatedStatus.textContent = error instanceof TypeError ? '로컬 서버에 연결하지 못했습니다. 서버 실행 후 다시 시도해 주세요.'
      : error instanceof DOMException && error.name === 'TimeoutError' ? '관련 뉴스 요청 시간이 초과됐습니다. 다시 시도해 주세요.'
      : error instanceof Error ? error.message : '관련 뉴스를 가져오지 못했습니다.';
    relatedRetry.hidden = false; updateButtons();
    aiConnection.refresh();
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
  url.hidden = !state?.page;
  if (state?.page) {
    url.href = state.page.url;
    url.title = state.page.url;
    url.setAttribute('aria-label', `원문 열기: ${state.page.title || state.page.url} (새 탭에서 열림)`);
    try { source.textContent = state.page.article?.siteName || new URL(state.page.url).hostname.replace(/^www\./, ''); }
    catch { source.textContent = ''; }
  } else { url.removeAttribute('href'); url.removeAttribute('aria-label'); source.textContent = ''; }
  selected.textContent = state?.page?.selectedText || '기사에서 이해하기 어려운 문장을 선택해 주세요.';
  count.textContent = state?.page?.selectedText
    ? `${state.page.selectedText.length.toLocaleString('ko-KR')}자${state.page.truncated ? ' · 앞부분' : ''}` : '';
  const canExpand = (state?.page?.selectedText.length || 0) > 260;
  expandSelection.hidden = !canExpand;
  selected.classList.toggle('is-collapsed', canExpand && expandSelection.getAttribute('aria-expanded') !== 'true');
  if (!canExpand) expandSelection.setAttribute('aria-expanded', 'false');
  status.dataset.state = state?.status || 'idle';
  contextStatus.dataset.ready = String(!!state?.page?.article && state.page.article.confidence !== 'low');
  selectionContext.textContent = state?.page?.article?.confidence === 'low' ? '문맥 제한' : state?.page?.article ? '문맥 확인됨' : '';
  status.textContent = state?.status === 'loading' ? '페이지 정보를 읽고 있습니다…'
    : state?.status === 'error' ? state.message || '페이지 정보를 읽지 못했습니다.'
    : state?.status === 'ready' ? ''
    : '읽고 있는 탭에서 Easynews 확장 아이콘을 눌러 주세요.';
  status.dataset.state = state?.status === 'error' ? 'error' : state?.status === 'loading' ? 'loading' : state?.status === 'ready' ? 'success' : '';
  status.dataset.loading = String(state?.status === 'loading');
  if ((state?.page?.selectedText.length || 0) > MAX_EXPLAIN_SELECTION) {
    explainStatus.textContent = 'AI 설명은 2,000자까지 가능합니다. 설명할 부분만 짧게 선택해 주세요.';
  }
  updateButtons();
}

async function explain(mode: ExplainMode) {
  if (closed || busy || !aiEnabled || !canExplain() || !currentState?.page) return;
  const selection = { title: currentState.page.title, selectedText: currentState.page.selectedText,
    surroundingContext: currentState.page.article?.confidence === 'low' ? undefined : currentState.page.article?.surroundingContext };
  busy = true;
  lastMode = mode;
  retry.hidden = true;
  answer.textContent = '';
  answerCard.hidden = true;
  explainStatus.textContent = '선택한 문장을 설명하고 있습니다…';
  explainStatus.dataset.state = 'loading'; explainStatus.dataset.loading = 'true';
  explainButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  updateButtons();
  try {
    const result = await explanation.run((signal) => requestExplanation(mode, selection, AbortSignal.any([signal, AbortSignal.timeout(40_000)])));
    if (result === undefined) return;
    busy = false;
    answer.textContent = result;
    answerTitle.textContent = mode === 'simple' ? '쉽게 설명' : mode === 'why' ? '왜 그런가' : '배경 설명';
    answerCard.hidden = false;
    explainStatus.textContent = 'AI 설명입니다. 기사 원문과 함께 확인해 주세요.';
    explainStatus.dataset.state = 'success'; explainStatus.dataset.loading = 'false';
    updateButtons();
  } catch (error) {
    busy = false;
    explainStatus.dataset.state = 'error'; explainStatus.dataset.loading = 'false';
    explainStatus.textContent = error instanceof TypeError ? '로컬 서버에 연결하지 못했습니다. 서버 실행 후 다시 시도해 주세요.'
      : error instanceof DOMException && error.name === 'TimeoutError' ? '응답 시간이 초과됐습니다. 다시 시도해 주세요.'
      : error instanceof Error ? error.message : '설명을 가져오지 못했습니다. 다시 시도해 주세요.';
    retry.hidden = false;
    updateButtons();
    aiConnection.refresh();
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
tabButtons.forEach((tab, index) => {
  tab.addEventListener('click', () => setActiveTab(index));
  tab.addEventListener('keydown', (event) => {
    const next = nextTabIndex(event.key, index, tabButtons.length);
    if (next !== undefined) { event.preventDefault(); setActiveTab(next, true); }
  });
});
expandSelection.addEventListener('click', () => {
  const expanded = expandSelection.getAttribute('aria-expanded') !== 'true';
  expandSelection.setAttribute('aria-expanded', String(expanded));
  expandSelection.textContent = expanded ? '접기' : '더 보기';
  selected.classList.toggle('is-collapsed', !expanded);
});
themeToggle.addEventListener('click', () => {
  const open = themeMenu.hidden;
  themeMenu.hidden = !open;
  themeToggle.setAttribute('aria-expanded', String(open));
  if (open) themeChoices.find((choice) => choice.getAttribute('aria-checked') === 'true')?.focus();
});
themeChoices.forEach((choice, index) => {
  choice.addEventListener('click', () => {
    const value = choice.dataset.themeChoice;
    if (value === 'system' || value === 'light' || value === 'dark') setTheme(value, true);
    themeMenu.hidden = true; themeToggle.setAttribute('aria-expanded', 'false'); themeToggle.focus();
  });
  choice.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowDown' ? (index + 1) % themeChoices.length
      : event.key === 'ArrowUp' ? (index + themeChoices.length - 1) % themeChoices.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? themeChoices.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); themeChoices[next]?.focus(); }
  });
});
themeMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { themeMenu.hidden = true; themeToggle.setAttribute('aria-expanded', 'false'); themeToggle.focus(); }
});
connectionMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { connectionMenu.open = false; document.querySelector<HTMLElement>('#connection-trigger')?.focus(); }
});
document.addEventListener('click', (event) => {
  if (!themeMenu.hidden && event.target instanceof Node && !themeMenu.contains(event.target) && !themeToggle.contains(event.target)) {
    themeMenu.hidden = true; themeToggle.setAttribute('aria-expanded', 'false');
  }
  if (connectionMenu.open && event.target instanceof Node && !connectionMenu.contains(event.target)) connectionMenu.open = false;
});
systemTheme.addEventListener('change', () => { if (themePreference === 'system') setTheme('system'); });
void loadTheme();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session') void sync();
  if (area === 'local' && Object.hasOwn(changes, THEME_KEY)) {
    setTheme(parseThemePreference(changes[THEME_KEY]?.newValue));
  }
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
