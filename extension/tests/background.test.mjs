import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/background.ts'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
const event = () => {
  const listeners = [];
  return { addListener: (listener) => listeners.push(listener), emit: (...args) => listeners.map((listener) => listener(...args)) };
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };

function setup() {
  const data = {};
  const tabs = new Map([
    [1, { id: 1, windowId: 10, url: 'https://news.example/a', status: 'complete' }],
    [2, { id: 2, windowId: 10, url: 'https://news.example/b', status: 'complete' }],
    [3, { id: 3, windowId: 20, url: 'https://news.example/c', status: 'complete' }],
  ]);
  const injections = [];
  const stopped = [];
  const opened = [];
  const chrome = {
    action: { onClicked: event() },
    commands: { onCommand: event() },
    sidePanel: { open: async ({ windowId }) => opened.push(windowId) },
    scripting: { executeScript: async ({ target }) => injections.push(target.tabId) },
    storage: { session: {
      set: async (values) => Object.assign(data, values),
      get: async (key) => ({ [key]: data[key] }),
      remove: async (key) => { delete data[key]; },
    } },
    runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`, onConnect: event(), onMessage: event() },
    tabs: {
      get: async (tabId) => tabs.get(tabId),
      query: async ({ windowId }) => [...tabs.values()].filter((tab) => tab.windowId === windowId),
      sendMessage: async (tabId) => stopped.push(tabId),
      onUpdated: event(), onRemoved: event(), onActivated: event(),
    },
  };
  runInNewContext(code, { chrome, console, URL });
  const activate = async (tabId) => { chrome.action.onClicked.emit(tabs.get(tabId)); await flush(); };
  const snapshot = async (tabId = 1, overrides = {}, senderOverrides = {}) => {
    const page = { title: '기사 제목', url: tabs.get(tabId).url, selectedText: '선택 문장', truncated: false,
      article: { title: '기사 제목', url: tabs.get(tabId).url, textContent: '짧은 도입부', surroundingContext: '선택 문장의 문단', extractionMethod: 'fallback', confidence: 'medium' }, ...overrides };
    const sender = { id: 'test', tab: tabs.get(tabId), frameId: 0, ...senderOverrides };
    chrome.runtime.onMessage.emit({ type: 'PAGE_SNAPSHOT', page }, sender, () => {});
    await flush();
  };
  return { chrome, data, tabs, injections, stopped, opened, activate, snapshot };
}

test('captures only after user action and rejects invalid snapshots and senders', async () => {
  const env = setup();
  await env.snapshot();
  assert.equal(env.data['tab:1'], undefined);
  await env.activate(1);
  assert.deepEqual(env.opened, [10]);
  assert.deepEqual(env.injections, [1]);
  await env.snapshot(1, {}, { frameId: 1 });
  await env.snapshot(1, {}, { id: 'foreign' });
  await env.snapshot(1, { selectedText: '가'.repeat(8_001) });
  await env.snapshot(1, { url: 'https://news.example/old' });
  assert.equal(env.data['tab:1'].status, 'loading');
  await env.snapshot();
  assert.equal(env.data['tab:1'].page.selectedText, '선택 문장');
});

test('mode shortcuts capture the active article and only notify its window panel', async () => {
  const env = setup(); const messages = [];
  for (const windowId of [10, 20]) env.chrome.runtime.onConnect.emit({ name: `panel:${windowId}`, sender: { id: 'test', url: env.chrome.runtime.getURL('sidepanel.html') }, onDisconnect: event(), postMessage: (message) => messages.push({ windowId, message }) });
  env.chrome.commands.onCommand.emit('explain-why', env.tabs.get(1)); await flush();
  assert.deepEqual(env.opened, [10]); assert.deepEqual(env.injections, [1]);
  assert.equal(messages.length, 1); assert.equal(messages[0].windowId, 10);
  assert.equal(messages[0].message.mode, 'why'); assert.equal(messages[0].message.tabId, 1);
  assert.equal(env.data['tab:1'].status, 'loading');
  await env.snapshot();
  env.chrome.commands.onCommand.emit('explain-simple', env.tabs.get(1)); await flush();
  assert.equal(env.data['tab:1'].status, 'ready');
  assert.equal(messages.length, 2);
  env.tabs.get(2).url = 'chrome://version';
  env.chrome.commands.onCommand.emit('explain-simple', env.tabs.get(2)); await flush();
  assert.equal(messages.length, 2);
});

test('closing the panel clears state and late messages cannot restore it', async () => {
  const env = setup();
  const port = { name: 'panel:10', sender: { id: 'test', url: env.chrome.runtime.getURL('sidepanel.html') }, onDisconnect: event() };
  env.chrome.runtime.onConnect.emit(port);
  await env.activate(1);
  await env.snapshot();
  assert.equal(env.data['tab:1'].page.article.surroundingContext, '선택 문장의 문단');
  port.onDisconnect.emit();
  await flush();
  await env.snapshot();
  assert.equal(env.data['tab:1'], undefined);
  assert.ok(env.stopped.includes(1));
});

test('switching tabs clears the old selection without affecting another window', async () => {
  const env = setup();
  await env.activate(1);
  await env.snapshot();
  await env.activate(3);
  await env.snapshot(3);
  assert.equal(env.data['tab:1'].page.article.textContent, '짧은 도입부');
  env.chrome.tabs.onActivated.emit({ tabId: 2, windowId: 10 });
  await flush();
  assert.equal(env.data['tab:1'], undefined);
  assert.equal(env.data['tab:3'].status, 'ready');
});

test('navigation queued behind an in-flight snapshot removes its state', async () => {
  const env = setup();
  await env.activate(1);
  const get = env.chrome.tabs.get;
  let release;
  env.chrome.tabs.get = async (tabId) => { await new Promise((done) => { release = done; }); return get(tabId); };
  env.chrome.runtime.onMessage.emit({ type: 'PAGE_SNAPSHOT', page: { title: '제목', url: env.tabs.get(1).url, selectedText: '늦은 선택', truncated: false } }, { id: 'test', tab: env.tabs.get(1), frameId: 0 }, () => {});
  await flush();
  env.chrome.tabs.onUpdated.emit(1, { status: 'loading' });
  release();
  await flush();
  assert.equal(env.data['tab:1'], undefined);
  assert.ok(env.stopped.includes(1));
});

test('restricted pages, loading pages and failed injection expose errors', async () => {
  const env = setup();
  env.tabs.get(1).url = 'chrome://version';
  await env.activate(1);
  assert.equal(env.data['tab:1'].status, 'error');
  env.tabs.get(2).status = 'loading';
  await env.activate(2);
  assert.equal(env.data['tab:2'].status, 'error');
  assert.equal(env.injections.length, 0);
  env.chrome.scripting.executeScript = async () => { throw new Error('Denied'); };
  await env.activate(3);
  assert.equal(env.data['tab:3'].status, 'error');
});
