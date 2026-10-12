import { stateKey, type TabState } from './state';
import { ExplanationSession, MAX_EXPLAIN_SELECTION, requestExplanation, type ExplainMode, type ExplainOptions, type ExplanationDetails } from './explanation';
import { requestRelated, WARNING_MESSAGES, EMPTY_REASONS, type RelatedArticle } from './related-news';
import { mountChatGPTConnection, type AiStatus } from './chatgpt-connection';
import { explanationSections } from './explanation-view';
import { nextTabIndex, relatedGroupState, resolveTheme, themePreference as parseThemePreference, type ThemePreference } from './sidepanel-view';

const title = document.querySelector<HTMLHeadingElement>('#page-title')!;
const url = document.querySelector<HTMLAnchorElement>('#page-url')!;
const source = document.querySelector<HTMLSpanElement>('#article-source')!;
const connectionMenu = document.querySelector<HTMLDetailsElement>('#connection-menu')!;
const connectionLabel = document.querySelector<HTMLSpanElement>('#connection-label')!;
const connectionDot = document.querySelector<HTMLSpanElement>('#connection-dot')!;
const selected = document.querySelector<HTMLQuoteElement>('#selected-text')!;
const selectionHeading = document.querySelector<HTMLDivElement>('#selection-heading')!;
const selectionEmpty = document.querySelector<HTMLDivElement>('#selection-empty')!;
const readingOptions = document.querySelector<HTMLDivElement>('#reading-options')!;
const contextPreview = document.querySelector<HTMLDetailsElement>('#context-preview')!;
const contextExcerpt = document.querySelector<HTMLParagraphElement>('#context-excerpt')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const count = document.querySelector<HTMLParagraphElement>('#selection-count')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const explainButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
const answer = document.querySelector<HTMLDivElement>('#answer')!;
const answerCard = document.querySelector<HTMLElement>('#answer-card')!;
const answerTitle = document.querySelector<HTMLHeadingElement>('#answer-title')!;
const evidencePreview = document.querySelector<HTMLDetailsElement>('#evidence-preview')!;
const evidenceQuotes = document.querySelector<HTMLDivElement>('#evidence-quotes')!;
const explainStatus = document.querySelector<HTMLParagraphElement>('#explain-status')!;
const explainHint = document.querySelector<HTMLParagraphElement>('#explain-hint')!;
const checkAiConnection = document.querySelector<HTMLButtonElement>('#check-ai-connection')!;
const returnButton = document.querySelector<HTMLButtonElement>('#return-to-article')!;
const returnStatus = document.querySelector<HTMLParagraphElement>('#return-status')!;
const retry = document.querySelector<HTMLButtonElement>('#retry-explain')!;
const stopExplain = document.querySelector<HTMLButtonElement>('#stop-explain')!;
const depthChoice = document.querySelector<HTMLSelectElement>('#explanation-depth')!;
const structureButton = document.querySelector<HTMLButtonElement>('#explain-structure')!;
const questionForm = document.querySelector<HTMLFormElement>('#question-form')!;
const questionText = document.querySelector<HTMLInputElement>('#question-text')!;
const askQuestion = document.querySelector<HTMLButtonElement>('#ask-question')!;
const quickQuestions = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-quick-question]'));
const suggestedQuestions = document.querySelector<HTMLDivElement>('#suggested-questions')!;
const revealSelection = document.querySelector<HTMLButtonElement>('#reveal-selection')!;
const contextStatus = document.querySelector<HTMLParagraphElement>('#context-status')!;
const relatedButton = document.querySelector<HTMLButtonElement>('#find-related')!;
const relatedScope = document.querySelector<HTMLSelectElement>('#related-scope')!;
const relatedScopeHelp = document.querySelector<HTMLParagraphElement>('#related-scope-help')!;
const relatedDescription = document.querySelector<HTMLParagraphElement>('#related-description')!;
const relatedEmptyTitle = document.querySelector<HTMLHeadingElement>('#related-empty-title')!;
const relatedSelection = document.querySelector<HTMLQuoteElement>('#related-selection')!;
const followUpsGroup = document.querySelector<HTMLElement>('#follow-ups-group')!;
const backgroundTitle = document.querySelector<HTMLHeadingElement>('#background-title')!;
const selectionBackground = document.querySelector<HTMLButtonElement>('#selection-background')!;
const relatedStatus = document.querySelector<HTMLParagraphElement>('#related-status')!;
const relatedRetry = document.querySelector<HTMLButtonElement>('#retry-related')!;
const followUps = document.querySelector<HTMLOListElement>('#follow-ups')!;
const backgroundNews = document.querySelector<HTMLOListElement>('#background-news')!;
const followUpsCount = document.querySelector<HTMLSpanElement>('#follow-ups-count')!;
const backgroundCount = document.querySelector<HTMLSpanElement>('#background-count')!;
const followUpsEmpty = document.querySelector<HTMLParagraphElement>('#follow-ups-empty')!;
const backgroundEmpty = document.querySelector<HTMLParagraphElement>('#background-empty')!;
const relatedEmpty = document.querySelector<HTMLDivElement>('#related-empty')!;
const relatedEmptyReason = document.querySelector<HTMLParagraphElement>('#related-empty-reason')!;
const relatedResults = document.querySelector<HTMLDivElement>('#related-results')!;
const relatedWaitNote = document.querySelector<HTMLParagraphElement>('#related-wait-note')!;
const relatedProgress = document.querySelector<HTMLOListElement>('#related-progress')!;
const selectionContext = document.querySelector<HTMLSpanElement>('#selection-context')!;
const expandSelection = document.querySelector<HTMLButtonElement>('#expand-selection')!;
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
const themeMenu = document.querySelector<HTMLDivElement>('#theme-menu')!;
const themeChoices = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]'));
const densityChoices = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-density-choice]'));
const textSizeChoices = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-text-size-choice]'));
const settingChoices = [...themeChoices, ...densityChoices, ...textSizeChoices];
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_KEY = 'easynewsTheme';
const DENSITY_KEY = 'easynewsDensity';
const TEXT_SIZE_KEY = 'easynewsTextSize';
let themePreference: ThemePreference = 'system';
let previousConnectionState = '';
const explanation = new ExplanationSession();
const relatedSession = new ExplanationSession();
let relatedBusy = false;
let currentState: TabState | undefined;
let currentKey = '';
let busy = false;
let lastMode: ExplainMode | undefined;
let lastOptions: ExplainOptions = {};
let revision = 0;
let port: chrome.runtime.Port | undefined;
let closed = false;
let aiEnabled = true;
let aiStatus: AiStatus | undefined;
const aiConnection = mountChatGPTConnection((enabled, invalidate, next) => {
  aiEnabled = enabled;
  aiStatus = next;
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
  if (persist) void chrome.storage.local.set({ [THEME_KEY]: preference }).catch(() => undefined);
}

async function loadTheme() {
  try {
    const values = await chrome.storage.local.get([THEME_KEY, DENSITY_KEY, TEXT_SIZE_KEY]);
    setTheme(parseThemePreference(values[THEME_KEY]));
    setLayoutPreference('density', values[DENSITY_KEY]);
    setLayoutPreference('textSize', values[TEXT_SIZE_KEY]);
  } catch { setTheme('system'); }
}

function setLayoutPreference(kind: 'density' | 'textSize', value: unknown, persist = false) {
  const preference = kind === 'density' ? value === 'comfortable' ? 'comfortable' : 'compact'
    : value === 'small' ? 'small' : 'normal';
  document.documentElement.dataset[kind] = preference;
  const choices = kind === 'density' ? densityChoices : textSizeChoices;
  choices.forEach((choice) => choice.setAttribute('aria-checked', String(choice.dataset[kind === 'density' ? 'densityChoice' : 'textSizeChoice'] === preference)));
  if (persist) void chrome.storage.local.set({ [kind === 'density' ? DENSITY_KEY : TEXT_SIZE_KEY]: preference }).catch(() => undefined);
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
  structureButton.disabled = retry.disabled;
  structureButton.hidden = !currentState?.page?.selectedText.trim();
  stopExplain.hidden = !busy;
  depthChoice.disabled = busy;
  askQuestion.disabled = questionText.disabled = busy || !canExplain() || !aiEnabled;
  quickQuestions.forEach((button) => { button.disabled = askQuestion.disabled; });
  suggestedQuestions.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = askQuestion.disabled; });
  revealSelection.disabled = currentState?.status !== 'ready' || !currentState.page?.selectedText.trim();
  returnButton.disabled = revealSelection.disabled;
  returnButton.hidden = busy || answerCard.hidden;
  const text = currentState?.page?.selectedText || '';
  explainHint.textContent = currentState?.status === 'loading' ? '페이지를 읽고 있습니다. 잠시 기다려 주세요.'
    : currentState?.status === 'error' ? '위 안내를 확인해 주세요. 페이지 접근을 시작하려면 기사에서 Easynews 확장 아이콘을 다시 눌러 주세요.'
    : currentState?.status !== 'ready' ? '먼저 읽고 있는 기사에서 Easynews 확장 아이콘을 눌러 주세요.'
    : !text.trim() ? '기사에서 설명할 문장을 짧게 드래그해 주세요.'
    : text.length > MAX_EXPLAIN_SELECTION ? '설명은 2,000자까지 가능합니다. 이해하기 어려운 부분만 짧게 선택해 주세요.'
    : !aiEnabled ? !aiStatus ? '로컬 서버 연결을 확인한 뒤 아래 AI 연결 확인을 눌러 주세요.'
      : aiStatus.usageLimited ? 'ChatGPT 사용 한도에 도달했습니다. AI 연결 메뉴에서 사용 한도를 확인해 주세요.'
      : aiStatus.status === 'connecting' ? 'ChatGPT 연결을 진행 중입니다. 브라우저에서 연결을 완료해 주세요.'
      : 'AI 설명을 사용하려면 아래 AI 연결 확인에서 연결 상태를 확인해 주세요.'
    : '';
  explainHint.hidden = !explainHint.textContent;
  checkAiConnection.hidden = aiEnabled || !canExplain();
  const article = currentState?.page?.article;
  const selectionScope = relatedScope.value === 'selection';
  const canRelate = currentState?.status === 'ready' && !!article && (selectionScope ? canExplain() : article.confidence !== 'low' && (article.textContent?.trim().length || 0) >= 80);
  selectionBackground.disabled = relatedBusy || !canExplain() || !article || !aiEnabled;
  selectionBackground.hidden = busy || answerCard.hidden;
  followUpsGroup.hidden = selectionScope;
  backgroundTitle.textContent = selectionScope ? '이 문장 이해를 돕는 배경 기사' : '배경 기사';
  relatedDescription.textContent = selectionScope ? '이 문장의 개념과 관계를 풀어주는 배경 기사를 찾습니다.' : '현재 사건의 후속 기사와 배경 기사를 찾아봅니다.';
  relatedEmptyTitle.textContent = selectionScope ? '이 문장을 이해하는 데 직접 도움이 되는 배경 기사를 찾지 못했어요.' : '직접 이어지는 후속·배경 기사를 찾지 못했어요.';
  relatedButton.textContent = selectionScope ? '배경 기사 찾기' : '관련 뉴스 찾기';
  backgroundEmpty.textContent = selectionScope ? '선택 문장의 직접 배경으로 분류할 만한 기사가 검색되지 않았습니다.' : '현재 사건의 직접 배경으로 분류할 만한 기사가 검색되지 않았습니다.';
  relatedSelection.hidden = !selectionScope || !text.trim(); relatedSelection.textContent = selectionScope ? text : '';
  relatedScopeHelp.textContent = selectionScope ? !canExplain() ? '기사에서 배경을 알고 싶은 문장을 1~2,000자 선택해 주세요.'
    : '선택 문장과 제공된 주변 문맥으로 이해에 필요한 배경 기사를 찾습니다.' : '현재 기사와 이어지는 기사·배경 기사를 찾습니다.';
  relatedButton.disabled = relatedBusy || !canRelate || !aiEnabled;
  relatedRetry.disabled = relatedBusy || !canRelate || !aiEnabled;
}

function clearExplanation() {
  explanation.invalidate();
  busy = false;
  lastMode = undefined;
  lastOptions = {};
  questionText.value = ''; questionForm.hidden = true;
  suggestedQuestions.replaceChildren(); suggestedQuestions.hidden = true;
  contextPreview.open = false;
  answer.textContent = '';
  evidencePreview.hidden = true; evidencePreview.open = false; evidenceQuotes.replaceChildren();
  answerCard.hidden = true;
  answerCard.setAttribute('aria-busy', 'false');
  returnButton.hidden = true;
  returnStatus.textContent = '';
  explainButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  expandSelection.setAttribute('aria-expanded', 'false');
  expandSelection.textContent = '더 보기';
  explainStatus.textContent = '';
  explainStatus.dataset.state = ''; explainStatus.dataset.loading = 'false';
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

function renderNews(list: HTMLOListElement, articles: RelatedArticle[], kind: 'follow_up' | 'background', ruleBased = false) {
  list.replaceChildren();
  for (const article of articles) {
    const item = document.createElement('li');
    const card = document.createElement('article'); card.className = 'news-card';
    const heading = document.createElement('h4'); heading.textContent = article.title;
    const metadata = document.createElement('p'); metadata.className = 'news-meta';
    const date = article.publishedAt ? new Date(article.publishedAt) : undefined;
    metadata.textContent = `${article.source} · ${date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '날짜 미확인'}`;
    const reason = document.createElement('p'); reason.className = 'news-reason';
    const reasonLabel = document.createElement('span'); reasonLabel.className = 'news-reason-label';
    reasonLabel.textContent = ruleBased ? '규칙으로 확인한 관계 · ' : kind === 'follow_up' ? '새로운 점 · ' : '이해에 도움 · ';
    reason.append(reasonLabel, document.createTextNode(article.relationReason));
    const link = document.createElement('a'); link.className = 'news-link'; link.textContent = '언론사 원문 읽기 ↗'; link.href = article.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `언론사 원문: ${article.title} (새 탭에서 열림)`);
    card.append(heading, metadata, reason, link); item.append(card); list.append(item);
    if (article.alternatives?.length) {
      const details = document.createElement('details'); details.className = 'news-alternatives';
      const summary = document.createElement('summary'); summary.textContent = `같은 진행의 다른 보도 ${article.alternatives.length}건 · AI 판정`;
      const links = document.createElement('ul');
      for (const alternative of article.alternatives) {
        const entry = document.createElement('li');
        const original = document.createElement('a'); original.textContent = `${alternative.source} · ${alternative.title}`;
        original.href = alternative.url; original.target = '_blank'; original.rel = 'noopener noreferrer';
        original.setAttribute('aria-label', `${alternative.title} (새 탭에서 열림)`); entry.append(original); links.append(entry);
      }
      details.append(summary, links); card.append(details);
    }
  }
}

async function findRelated() {
  const article = currentState?.page?.article;
  if (closed || relatedBusy || relatedButton.disabled || !article) return;
  relatedBusy = true; relatedRetry.hidden = true; relatedEmpty.hidden = true; relatedResults.hidden = true;
  const selection = relatedScope.value === 'selection' ? { selectedText: currentState!.page!.selectedText,
    ...(article.confidence !== 'low' && article.surroundingContext ? { surroundingContext: article.surroundingContext } : {}) } : undefined;
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
      }, selection));
    if (result === undefined) return;
    relatedBusy = false;
    const ruleBased = result.warnings.includes('RULE_BASED') || result.warnings.includes('RELATION_CLASSIFICATION_FAILED');
    renderNews(followUps, result.followUps, 'follow_up', ruleBased); renderNews(backgroundNews, result.background, 'background', ruleBased);
    relatedStatus.dataset.state = 'success'; relatedStatus.dataset.loading = 'false';
    relatedWaitNote.hidden = true; updateRelatedProgress('classifying', true);
    const completionMessage = result.followUps.length || result.background.length ? '제목과 관계를 확인했어요. 원문에서 내용을 확인해 주세요.' : '검색이 완료됐습니다.';
    relatedStatus.textContent = [completionMessage, ...result.warnings.map((warning) => WARNING_MESSAGES[warning])].join(' ');
    const groups = relatedGroupState(result.followUps.length, result.background.length);
    relatedResults.hidden = groups.showCombinedEmpty;
    relatedEmpty.hidden = !groups.showCombinedEmpty;
    relatedEmptyReason.textContent = result.emptyReason ? EMPTY_REASONS[result.emptyReason] : selection ? '선택 문장을 직접 이해하는 데 도움이 되는 배경 후보가 확인되지 않았습니다.' : '현재 기사와 직접 이어지는 후속·배경 후보가 확인되지 않았습니다.';
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
  if (relatedScope.value === 'selection' && (state?.page?.selectedText !== currentState?.page?.selectedText
    || state?.page?.article?.surroundingContext !== currentState?.page?.article?.surroundingContext)) clearRelated();
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
  const hasSelection = state?.status === 'ready' && !!state.page?.selectedText.trim();
  selectionEmpty.hidden = hasSelection;
  selectionHeading.hidden = selected.hidden = readingOptions.hidden = !hasSelection;
  selected.textContent = state?.page?.selectedText || '';
  contextPreview.hidden = !hasSelection;
  const surrounding = state?.page?.article?.surroundingContext?.replace(/\s+/g, ' ').trim() || '';
  const normalizedSelection = (state?.page?.selectedText || '').replace(/\s+/g, ' ').trim();
  const selectionIndex = normalizedSelection ? surrounding.indexOf(normalizedSelection) : -1;
  if (selectionIndex >= 0) {
    const mark = document.createElement('mark'); mark.textContent = normalizedSelection;
    contextExcerpt.replaceChildren(document.createTextNode(surrounding.slice(0, selectionIndex)), mark,
      document.createTextNode(surrounding.slice(selectionIndex + normalizedSelection.length)));
  } else contextExcerpt.textContent = surrounding || '앞뒤 문맥을 찾지 못했습니다. 기사에서 앞뒤 문장을 직접 확인해 주세요.';
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
  updateButtons();
}

async function explain(mode: ExplainMode, options: ExplainOptions = {}) {
  if (closed || busy || !aiEnabled || !canExplain() || !currentState?.page) return;
  const selection = { title: currentState.page.title, selectedText: currentState.page.selectedText,
    surroundingContext: currentState.page.article?.confidence === 'low' ? undefined : currentState.page.article?.surroundingContext };
  busy = true;
  lastMode = mode;
  const requestOptions: ExplainOptions = { ...options, readingTools: true, depth: options.depth || (depthChoice.value === 'detailed' ? 'detailed' : 'short') };
  lastOptions = requestOptions;
  questionForm.hidden = true;
  suggestedQuestions.replaceChildren(); suggestedQuestions.hidden = true;
  retry.hidden = true;
  answer.textContent = '';
  answerCard.hidden = true;
  returnStatus.textContent = '';
  evidencePreview.hidden = true; evidencePreview.open = false; evidenceQuotes.replaceChildren();
  explainStatus.textContent = '선택한 문장을 설명하고 있습니다…';
  explainStatus.dataset.state = 'loading'; explainStatus.dataset.loading = 'true';
  explainButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  updateButtons();
  try {
    answer.setAttribute('aria-live', 'off'); answerCard.setAttribute('aria-busy', 'true');
    answerTitle.textContent = `${requestOptions.structure ? '문장 구조' : mode === 'simple' ? '쉽게 설명' : mode === 'why' ? '왜 그런가' : '배경 설명'} · 작성 중`;
    let details: ExplanationDetails = {};
    const result = await explanation.run((signal) => requestExplanation(mode, selection, AbortSignal.any([signal, AbortSignal.timeout(40_000)]), undefined,
      (text) => { if (!closed && !signal.aborted) { renderAnswer(text); answerCard.hidden = false; } }, requestOptions, (value) => { details = value; }));
    if (result === undefined) return;
    busy = false;
    renderAnswer(result);
    evidenceQuotes.replaceChildren(...(details.evidence || []).map((item) => {
      const container = document.createElement('div');
      const label = document.createElement('p'); label.className = 'caption'; label.textContent = item.source === 'selectedText' ? '선택한 문장' : '주변 문맥';
      const quote = document.createElement('blockquote'); quote.className = 'evidence-quote'; quote.textContent = item.quote;
      container.append(label, quote); return container;
    }));
    if (!evidenceQuotes.childElementCount) {
      const message = document.createElement('p'); message.className = 'caption'; message.textContent = '원문과 일치하는 근거 구절이 제공되지 않았습니다. 앞뒤 문맥과 함께 확인해 주세요.'; evidenceQuotes.append(message);
    }
    evidencePreview.hidden = false;
    answerTitle.textContent = requestOptions.structure ? '문장 구조' : requestOptions.question ? '현재 문장 질문'
      : mode === 'simple' ? '쉽게 설명' : mode === 'why' ? '왜 그런가' : '배경 설명';
    answerCard.hidden = false;
    answerCard.setAttribute('aria-busy', 'false'); answer.setAttribute('aria-live', 'polite');
    questionForm.hidden = false; questionText.value = '';
    suggestedQuestions.replaceChildren(...(details.suggestedQuestions || []).map((question) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = question;
      button.addEventListener('click', () => void explain(lastMode || 'simple', { question }));
      return button;
    }));
    suggestedQuestions.hidden = !suggestedQuestions.childElementCount;
    explainStatus.textContent = 'AI 설명입니다. 기사 원문과 함께 확인해 주세요.';
    explainStatus.dataset.state = 'success'; explainStatus.dataset.loading = 'false';
    updateButtons();
  } catch (error) {
    busy = false;
    answer.replaceChildren(); answerCard.hidden = true; answerCard.setAttribute('aria-busy', 'false');
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
    if (request === revision) render({ status: 'error', message: '상태를 확인하지 못했습니다. 상태 확인을 눌러 주세요.' });
  }
}

refresh.addEventListener('click', () => { void sync(); aiConnection.refresh(); });
checkAiConnection.addEventListener('click', () => {
  connectionMenu.open = true;
  document.querySelector<HTMLElement>('#connection-trigger')!.focus();
  aiConnection.refresh();
});
function renderAnswer(text: string) {
  answer.replaceChildren(...explanationSections(text).map((part) => {
    const section = document.createElement('section');
    section.className = 'answer-section';
    if (part.label) {
      const label = document.createElement('h4');
      label.className = 'answer-label'; label.textContent = part.label;
      section.append(label);
    }
    for (const paragraph of part.paragraphs) {
      const item = document.createElement('p'); item.textContent = paragraph; section.append(item);
    }
    return section;
  }));
}

for (const button of explainButtons) button.addEventListener('click', () => void explain(button.dataset.mode as ExplainMode));
structureButton.addEventListener('click', () => void explain('simple', { structure: true }));
retry.addEventListener('click', () => { if (lastMode) void explain(lastMode, lastOptions); });
stopExplain.addEventListener('click', () => {
  const mode = lastMode; const options = lastOptions; clearExplanation(); lastMode = mode; lastOptions = options;
  explainStatus.textContent = '설명을 중지했습니다.';
  explainStatus.dataset.loading = 'false'; explainStatus.dataset.state = '';
  retry.hidden = false; updateButtons();
});
questionForm.addEventListener('submit', (event) => { event.preventDefault(); void explain(lastMode || 'simple', { question: questionText.value.trim() }); });
quickQuestions.forEach((button) => button.addEventListener('click', () => {
  void explain(lastMode || 'simple', { question: button.dataset.quickQuestion });
}));
revealSelection.addEventListener('click', () => void returnToArticle());
returnButton.addEventListener('click', () => void returnToArticle(returnStatus));

async function returnToArticle(feedback = status) {
  const key = currentKey; const pageUrl = currentState?.page?.url;
  if (!pageUrl) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (closed || currentKey !== key || tab?.id === undefined || stateKey(tab.id) !== key) return;
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'REVEAL_SELECTION', url: pageUrl });
    if (closed || currentKey !== key || currentState?.page?.url !== pageUrl) return;
    feedback.textContent = result?.ok ? '' : '원문 위치를 찾지 못했습니다. 기사에서 문장을 다시 선택해 주세요.';
    feedback.dataset.state = result?.ok ? '' : 'error';
  } catch {
    if (closed || currentKey !== key || currentState?.page?.url !== pageUrl) return;
    feedback.textContent = '원문 위치로 이동하지 못했습니다. 기사에서 Easynews 확장 아이콘을 다시 누르고 문장을 선택해 주세요.';
    feedback.dataset.state = 'error';
  }
}
relatedButton.addEventListener('click', () => void findRelated());
relatedRetry.addEventListener('click', () => void findRelated());
relatedScope.addEventListener('change', () => { clearRelated(); updateButtons(); });
selectionBackground.addEventListener('click', () => {
  relatedScope.value = 'selection'; clearRelated(); updateButtons(); setActiveTab(1, true); void findRelated();
});
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
settingChoices.forEach((choice, index) => {
  choice.addEventListener('click', () => {
    const value = choice.dataset.themeChoice;
    if (value === 'system' || value === 'light' || value === 'dark') setTheme(value, true);
    if (choice.dataset.densityChoice) setLayoutPreference('density', choice.dataset.densityChoice, true);
    if (choice.dataset.textSizeChoice) setLayoutPreference('textSize', choice.dataset.textSizeChoice, true);
    themeMenu.hidden = true; themeToggle.setAttribute('aria-expanded', 'false'); themeToggle.focus();
  });
  choice.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowDown' ? (index + 1) % settingChoices.length
      : event.key === 'ArrowUp' ? (index + settingChoices.length - 1) % settingChoices.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? settingChoices.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); settingChoices[next]?.focus(); }
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
  if (area === 'local' && Object.hasOwn(changes, DENSITY_KEY)) setLayoutPreference('density', changes[DENSITY_KEY]?.newValue);
  if (area === 'local' && Object.hasOwn(changes, TEXT_SIZE_KEY)) setLayoutPreference('textSize', changes[TEXT_SIZE_KEY]?.newValue);
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
