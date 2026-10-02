import { createApp } from './app.js';
import { createExplainer } from './openai.js';

const extensionId = process.env.EASYNEWS_EXTENSION_ID?.trim() || '';
if (extensionId && !/^[a-p]{32}$/.test(extensionId)) {
  console.error('EASYNEWS_EXTENSION_ID must be the 32-character Chrome extension ID.');
  process.exit(1);
}
const app = createApp({ extensionId }, createExplainer({
  apiKey: process.env.OPENAI_API_KEY?.trim() || '',
  model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
}));
app.requestTimeout = 15_000;
app.headersTimeout = 10_000;
app.on('error', () => { console.error('Easynews server could not start. Check whether port 3000 is in use.'); process.exitCode = 1; });
app.listen(3000, '127.0.0.1', () => console.log('Easynews server: http://127.0.0.1:3000 (no request logging or storage)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { app.close(); app.closeAllConnections(); });
}
