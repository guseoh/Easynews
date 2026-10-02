import { MAX_SELECTION_LENGTH, type PageSnapshot } from './state';

// This marker belongs to the extension's isolated world, not the page's scripts.
const scope = window as Window & { easynewsCapture?: () => void };

if (scope.easynewsCapture) {
  scope.easynewsCapture();
} else {
  let selectedText = '';
  let truncated = false;
  let lastUrl = location.href;
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;

  const capture = () => {
    if (stopped) return;
    if (lastUrl !== location.href) {
      selectedText = '';
      truncated = false;
      lastUrl = location.href;
    }
    const selection = window.getSelection();
    const focus = document.activeElement;
    // Do not collect selections inside editors, password fields, or forms.
    const isEditable = focus?.matches('input, textarea, [contenteditable]:not([contenteditable="false"])')
      || selection?.anchorNode?.parentElement?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    const text = isEditable ? '' : selection?.toString().trim() ?? '';
    if (text) {
      selectedText = text.slice(0, MAX_SELECTION_LENGTH);
      truncated = text.length > MAX_SELECTION_LENGTH;
    }
    const page: PageSnapshot = {
      title: document.title.slice(0, 1_000),
      url: location.href,
      selectedText,
      truncated,
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
    clearTimeout(timer);
    document.removeEventListener('selectionchange', schedule);
    window.removeEventListener('pageshow', capture);
    window.removeEventListener('popstate', capture);
    window.removeEventListener('hashchange', capture);
    chrome.runtime.onMessage.removeListener(onMessage);
    delete scope.easynewsCapture;
  };
  const onMessage = (message: unknown) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'STOP_CAPTURE') stop();
  };
  scope.easynewsCapture = capture;
  document.addEventListener('selectionchange', schedule);
  window.addEventListener('pageshow', capture);
  window.addEventListener('popstate', capture);
  window.addEventListener('hashchange', capture);
  chrome.runtime.onMessage.addListener(onMessage);
  capture();
}
