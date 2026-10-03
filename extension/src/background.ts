import { isSnapshot, stateKey, type TabState } from './state';

const save = (tabId: number, state: TabState) => chrome.storage.session.set({ [stateKey(tabId)]: state });
const pending = new Map<number, Promise<void>>();
const panels = new Map<number, Set<chrome.runtime.Port>>();
const shortcuts = new Map<number, { type: 'EXPLAIN_MODE'; mode: string; tabId: number; url: string; expires: number; ready: boolean }>();

// Serialize writes and removals so a late selection cannot restore cleared data.
function enqueue(tabId: number, work: () => Promise<void>) {
  const task = (pending.get(tabId) || Promise.resolve()).then(work).catch(console.error);
  pending.set(tabId, task);
  void task.then(() => { if (pending.get(tabId) === task) pending.delete(tabId); });
  return task;
}

async function clearWindow(windowId: number, exceptTab?: number, onlyIfClosed = false) {
  const tabs = await chrome.tabs.query({ windowId });
  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === exceptTab) continue;
    const tabId = tab.id;
    await enqueue(tabId, async () => {
      if (onlyIfClosed && panels.get(windowId)?.size) return;
      await chrome.storage.session.remove(stateKey(tabId));
      await chrome.tabs.sendMessage(tabId, { type: 'STOP_CAPTURE' }).catch(() => {});
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id || port.sender.url !== chrome.runtime.getURL('sidepanel.html')) return;
  const windowId = Number(port.name.replace(/^panel:/, ''));
  if (!port.name.startsWith('panel:') || !Number.isInteger(windowId)) return;
  const openPanels = panels.get(windowId) || new Set<chrome.runtime.Port>();
  panels.set(windowId, openPanels);
  openPanels.add(port);
  const command = shortcuts.get(windowId);
  if (command?.ready) {
    if (command.expires > Date.now()) port.postMessage(command);
    shortcuts.delete(windowId);
  }
  port.onDisconnect.addListener(() => {
    openPanels.delete(port);
    if (!openPanels.size) { shortcuts.delete(windowId); void clearWindow(windowId, undefined, true).catch(console.error); }
  });
});

async function captureTab(tab: chrome.tabs.Tab, preserveState = false) {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    await save(tabId, { status: 'error', message: '이 페이지에는 접근할 수 없습니다. 일반 뉴스 웹페이지에서 확장 아이콘을 눌러 주세요.' });
    return;
  }
  if (tab.status === 'loading') {
    await save(tabId, { status: 'error', message: '페이지가 로딩 중입니다. 로딩이 끝난 뒤 확장 아이콘을 다시 눌러 주세요.' });
    return;
  }
  const prior = preserveState ? (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] as TabState | undefined : undefined;
  if (!prior || prior.status !== 'ready' || prior.page?.url !== tab.url) await save(tabId, { status: 'loading' });
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    await save(tabId, { status: 'error', message: '페이지 정보를 읽지 못했습니다. 페이지 로딩이 끝난 뒤 확장 아이콘을 다시 눌러 주세요.' });
  }
}

chrome.action.onClicked.addListener((tab) => {
  // Open synchronously with the user gesture, before waiting on injection/storage.
  void chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
    if (tab.id !== undefined) return enqueue(tab.id, () => captureTab(tab));
  }).catch(console.error);
});

chrome.commands.onCommand.addListener((name, tab) => {
  const mode = name === 'explain-simple' ? 'simple' : name === 'explain-why' ? 'why' : name === 'explain-background' ? 'background' : undefined;
  if (!mode || tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) return;
  const tabId = tab.id;
  const command = { type: 'EXPLAIN_MODE' as const, mode, tabId, url: tab.url, expires: Date.now() + 5_000, ready: false };
  shortcuts.set(tab.windowId, command);
  void chrome.sidePanel.open({ windowId: tab.windowId }).then(() => enqueue(tabId, () => captureTab(tab, !!panels.get(tab.windowId)?.size))).then(() => {
    if (shortcuts.get(tab.windowId) !== command || command.expires <= Date.now()) return;
    command.ready = true;
    const ports = panels.get(tab.windowId);
    if (ports?.size) { for (const port of ports) port.postMessage(command); shortcuts.delete(tab.windowId); }
  }).catch(() => { shortcuts.delete(tab.windowId); });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) return;
  if (!message || typeof message !== 'object' || !('type' in message)
    || message.type !== 'PAGE_SNAPSHOT' || !('page' in message) || !isSnapshot(message.page)) return;
  const page = message.page;
  const tabId = sender.tab.id;
  void enqueue(tabId, async () => {
    const tab = await chrome.tabs.get(tabId);
    const state = await chrome.storage.session.get(stateKey(tabId));
    // Discard messages from a page that was replaced while the message was in flight.
    if (state[stateKey(tabId)] && tab.url === page.url && tab.status !== 'loading') {
      await save(tabId, { status: 'ready', page });
    }
  }).then(() => respond());
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) {
    for (const [windowId, command] of shortcuts) if (command.tabId === tabId) shortcuts.delete(windowId);
    void enqueue(tabId, async () => {
      await chrome.storage.session.remove(stateKey(tabId));
      await chrome.tabs.sendMessage(tabId, { type: 'STOP_CAPTURE' }).catch(() => {});
    });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(tabId, () => chrome.storage.session.remove(stateKey(tabId)));
});
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  shortcuts.delete(windowId);
  void clearWindow(windowId, tabId).catch(console.error);
});
