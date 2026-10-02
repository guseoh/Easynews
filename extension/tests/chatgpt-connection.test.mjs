import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
const code = buildSync({ entryPoints: ['src/chatgpt-connection.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports, AbortSignal, chrome: { runtime: { id: 'test-extension' } } });
const { requestAiConnection, validateAiStatus } = module.exports;

test('connection status exposes only bounded UI metadata and strips supplier secrets', () => {
  const result = validateAiStatus({ provider: 'chatgpt-plan', status: 'connected', sharing: true, model: 'available-luna', account: 'test@example.test', access_token: 'secret', error: { code: 'CHATGPT_FAILED', message: 'secret' } });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  for (const value of [{}, { provider: 'chatgpt-plan', status: 'connected', sharing: true, account: 'a'.repeat(255) }, { provider: 'unknown', status: 'connected', sharing: true }]) assert.throws(() => validateAiStatus(value));
});
test('connection operations use fixed loopback routes, client guard and no-store without credentials', async () => {
  let call;
  await requestAiConnection('connect', { newProfile: true }, new AbortController().signal, async (url, options) => { call = { url, options }; return Response.json({ status: 'connecting' }); });
  assert.equal(call.url, 'http://127.0.0.1:3000/api/ai/connect');
  assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.headers['X-Easynews-Extension'], 'test-extension');
  assert.deepEqual(JSON.parse(call.options.body), { newProfile: true });
});
test('usage limit differs from connection failures and provider messages never reach UI', async () => {
  await assert.rejects(requestAiConnection('recheck', {}, new AbortController().signal, async () => Response.json({ error: { code: 'CHATGPT_USAGE_LIMIT', message: 'secret' } }, { status: 429 })), /Manage usage/);
  await assert.rejects(requestAiConnection('status', {}, new AbortController().signal, async () => Response.json({ error: { code: 'unknown', message: 'secret' } }, { status: 502 })), /AI 연결 요청에 실패/);
});
