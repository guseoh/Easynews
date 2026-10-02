import { createApp } from './app.js';
import { OpenAIApiKeyProvider, selectAiProvider } from './ai-provider.js';
import { createNaverSearch } from './naver.js';
import { createRelatedService } from './related.js';
import { createChatGPT } from '@siwc/local';
import { ChatGPTPlanProvider } from './chatgpt-plan.js';
import { createWindowsCredentialEncryption } from './credential-encryption.js';

const extensionId = process.env.EASYNEWS_EXTENSION_ID?.trim() || '';
if (extensionId && !/^[a-p]{32}$/.test(extensionId)) {
  console.error('EASYNEWS_EXTENSION_ID must be the 32-character Chrome extension ID.');
  process.exit(1);
}
const llmConfig = {
  apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
};
const plan = process.env.AI_PROVIDER?.trim() === 'chatgpt-plan' ? new ChatGPTPlanProvider(createChatGPT({
  appName: 'Easynews', appId: 'easynews', redirectPort: 0, sendHostId: true,
  credentialEncryption: createWindowsCredentialEncryption(),
})) : undefined;
const provider = selectAiProvider(process.env.AI_PROVIDER, new OpenAIApiKeyProvider(llmConfig), plan);
const app = createApp({ extensionId, providerId: provider.id }, provider.explain, createRelatedService(createNaverSearch({
  clientId: process.env.NAVER_CLIENT_ID?.trim() || '', clientSecret: process.env.NAVER_CLIENT_SECRET?.trim() || '',
}), provider.relatedLlm), plan);
app.requestTimeout = 15_000;
app.headersTimeout = 10_000;
app.on('error', () => { console.error('Easynews server could not start. Check whether port 3000 is in use.'); process.exitCode = 1; });
app.listen(3000, '127.0.0.1', () => console.log('Easynews server: http://127.0.0.1:3000 (no request logging or storage)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { plan?.cancelSignIn(); app.close(); app.closeAllConnections(); });
}
