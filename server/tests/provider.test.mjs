import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIApiKeyProvider, selectAiProvider } from '../dist/ai-provider.js';

test('provider selection retains migration default and rejects implicit billing fallback', () => {
  const key = { id: 'api-key' }, plan = { id: 'chatgpt-plan' };
  assert.equal(selectAiProvider(undefined, key, plan), key);
  assert.equal(selectAiProvider('chatgpt-plan', key, plan), plan);
  assert.throws(() => selectAiProvider('other', key, plan));
  assert.throws(() => selectAiProvider('chatgpt-plan', key));
});

test('API key provider preserves explanation and optional related adapters', async () => {
  const empty = new OpenAIApiKeyProvider({ apiKey: '', model: 'test-model' });
  assert.equal(empty.relatedLlm, undefined);
  await assert.rejects(empty.explain({}, new AbortController().signal), { code: 'SERVER_NOT_CONFIGURED' });
  let body;
  const provider = new OpenAIApiKeyProvider({ apiKey: 'synthetic', model: 'test-model' }, async (_, init) => {
    body = JSON.parse(init.body);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '설명' }] }] });
  });
  assert.ok(provider.relatedLlm);
  assert.equal(await provider.explain({ mode: 'simple', articleTitle: '제목', selectedText: '문장' }, new AbortController().signal), '설명');
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 1200);
});
