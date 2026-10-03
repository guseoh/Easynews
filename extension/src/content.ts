import { MAX_SELECTION_LENGTH, type PageSnapshot } from './state';
import { extractArticleContext, selectionContext, type ArticleContext } from './article-context';

// This marker belongs to the extension's isolated world, not the page's scripts.
const scope = window as Window & { easynewsCapture?: () => void };

if (scope.easynewsCapture) {
  scope.easynewsCapture();
} else {
  let selectedText = '';
  let truncated = false;
  let lastUrl = location.href;
  let article: ArticleContext | undefined;
  let surroundingContext = '';
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  let selectedRange: Range | undefined;
  let highlightStyle: HTMLStyleElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let clearFocusOverride: (() => void) | undefined;
  const focusOriginal = () => {
    clearFocusOverride?.();
    const selectedElement = selectedRange?.startContainer.isConnected ? selectedRange.startContainer.parentElement : undefined;
    const element = selectedElement?.closest<HTMLElement>('article') || selectedElement || document.querySelector<HTMLElement>('article') || document.body;
    const prior = element.getAttribute('tabindex');
    element.setAttribute('tabindex', '-1'); element.focus({ preventScroll: true });
    const restore = () => {
      if (prior === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', prior);
      element.removeEventListener('blur', restore); clearFocusOverride = undefined;
    };
    element.addEventListener('blur', restore, { once: true }); clearFocusOverride = restore;
  };
  const clearHighlight = () => {
    clearTimeout(highlightTimer); highlightStyle?.remove(); highlightStyle = undefined;
    CSS.highlights?.delete('easynews-reading');
  };

  const capture = () => {
    if (stopped) return;
    if (lastUrl !== location.href) {
      selectedText = '';
      truncated = false;
      lastUrl = location.href;
      article = undefined;
      surroundingContext = '';
      selectedRange = undefined; clearHighlight();
      clearFocusOverride?.();
    }
    article ??= extractArticleContext(document, location.href);
    const selection = window.getSelection();
    const focus = document.activeElement;
    // Do not collect selections inside editors, password fields, or forms.
    const isEditable = focus?.matches('input, textarea, [contenteditable]:not([contenteditable="false"])')
      || selection?.anchorNode?.parentElement?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    const text = isEditable ? '' : selection?.toString().trim() ?? '';
    if (text) {
      selectedText = text.slice(0, MAX_SELECTION_LENGTH);
      truncated = text.length > MAX_SELECTION_LENGTH;
      surroundingContext = article.confidence === 'low' ? '' : selectionContext(document, selectedText, selection);
      selectedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    }
    const page: PageSnapshot = {
      title: article.title,
      url: location.href,
      selectedText,
      truncated,
      article: { ...article, ...(surroundingContext ? { surroundingContext } : {}) },
    };
    // Retain the last nonempty selection when focus moves to the Side Panel.
    try {
      void chrome.runtime.sendMessage({ type: 'PAGE_SNAPSHOT', page }).catch(stop);
    } catch {
      stop(); // An extension reload invalidates old injected scripts.
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(capture, 120);
  };
  const stop = () => {
    stopped = true;
    selectedText = '';
    surroundingContext = '';
    article = undefined;
    selectedRange = undefined; clearHighlight();
    clearFocusOverride?.();
    clearTimeout(timer);
    document.removeEventListener('selectionchange', schedule);
    window.removeEventListener('pageshow', capture);
    window.removeEventListener('popstate', capture);
    window.removeEventListener('hashchange', capture);
    chrome.runtime.onMessage.removeListener(onMessage);
    delete scope.easynewsCapture;
  };
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object' || !('type' in message)) return;
    if (message.type === 'STOP_CAPTURE') { stop(); return; }
    if (message.type === 'FOCUS_ARTICLE') {
      if (stopped || !('url' in message) || message.url !== location.href || lastUrl !== location.href) { respond({ ok: false }); return; }
      focusOriginal(); respond({ ok: true }); return;
    }
    if (message.type !== 'REVEAL_SELECTION') return;
    if (stopped || !('url' in message) || message.url !== location.href || lastUrl !== location.href
      || !selectedRange?.startContainer.isConnected || selectedRange.toString().trim().slice(0, MAX_SELECTION_LENGTH) !== selectedText) { respond({ ok: false }); return; }
    const node = selectedRange.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    focusOriginal();
    clearHighlight();
    if (typeof Highlight !== 'undefined' && CSS.highlights) {
      highlightStyle = document.createElement('style');
      highlightStyle.textContent = '::highlight(easynews-reading) { background-color: #236fce; color: #fff; }';
      document.head.append(highlightStyle);
      CSS.highlights.set('easynews-reading', new Highlight(selectedRange));
      highlightTimer = setTimeout(clearHighlight, 2_000);
    } else {
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(selectedRange.cloneRange());
    }
    respond({ ok: true });
  };
  scope.easynewsCapture = capture;
  document.addEventListener('selectionchange', schedule);
  window.addEventListener('pageshow', capture);
  window.addEventListener('popstate', capture);
  window.addEventListener('hashchange', capture);
  chrome.runtime.onMessage.addListener(onMessage);
  capture();
}
