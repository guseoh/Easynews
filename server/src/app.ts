import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApiError, validateInput, MAX_ANSWER_LENGTH } from './explain.js';
import type { Explain } from './openai.js';
import { validateRelatedInput, type Related } from './related-types.js';
import { planError, type ChatGPTPlanProvider } from './chatgpt-plan.js';

const MAX_BODY_BYTES = 16_384;
const MAX_CONCURRENT_REQUESTS = 2;

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'JSON 요청만 지원합니다.');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume();
      throw new ApiError(413, 'INPUT_TOO_LARGE', '선택한 내용이 너무 깁니다. 짧은 문장을 선택해 주세요.');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', '요청 형식이 올바르지 않습니다.'); }
}

function send(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function createApp(config: { extensionId: string; providerId?: string; relatedTimeoutMs?: number }, explain: Explain, related?: Related, plan?: ChatGPTPlanProvider) {
  let active = 0; // A count only; no request text or response cache is retained.
  const origin = `chrome-extension://${config.extensionId}`;
  return createServer(async (request, response) => {
    const controller = new AbortController();
    let relatedStream = false;
    let explanationStream = false;
    const streamLine = (value: unknown) => { if (!response.destroyed && !response.writableEnded) response.write(JSON.stringify(value) + '\n'); };
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host || '')) {
        throw new ApiError(403, 'FORBIDDEN_HOST', '로컬 서버 주소를 확인해 주세요.');
      }
      if (request.url === '/health' && request.method === 'GET') {
        send(response, 200, { status: 'ok' });
        return;
      }
      if (!config.extensionId) throw new ApiError(503, 'SERVER_NOT_CONFIGURED', '로컬 서버의 Easynews 확장 ID를 설정해 주세요.');
      if (request.headers.origin && request.headers.origin !== origin) {
        throw new ApiError(403, 'FORBIDDEN_ORIGIN', '허용되지 않은 요청입니다.');
      }
      if (request.headers.origin === origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      const authRoute = ['/api/ai/status', '/api/ai/profiles', '/api/ai/connect', '/api/ai/disconnect', '/api/ai/recheck', '/api/ai/cancel'].includes(request.url || '');
      if (request.method === 'OPTIONS' && (authRoute || ['/api/explain', '/api/related'].includes(request.url || '')) && request.headers.origin === origin) {
        response.writeHead(204, {
          'Access-Control-Allow-Methods': authRoute ? 'GET, POST' : 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, X-Easynews-Extension',
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      if (request.headers['x-easynews-extension'] !== config.extensionId) {
        throw new ApiError(403, 'FORBIDDEN_CLIENT', '서버에 설정한 Easynews 확장 ID를 확인해 주세요.');
      }
      if (authRoute) {
        if (['/api/ai/status', '/api/ai/profiles'].includes(request.url || '') && request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'GET 요청만 지원합니다.');
        if (request.url === '/api/ai/status' && request.method === 'GET') {
          send(response, 200, plan ? await plan.status() : { provider: config.providerId || 'api-key', status: 'disconnected', sharing: false }); return;
        }
        if (!plan) throw new ApiError(503, 'CHATGPT_PROVIDER_DISABLED', '현재 API Key 방식으로 실행 중입니다.');
        try {
          if (request.url === '/api/ai/profiles' && request.method === 'GET') { send(response, 200, { profiles: await plan.profiles() }); return; }
          if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.');
          const data = await readJson(request);
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'INVALID_INPUT', '연결 요청 형식이 올바르지 않습니다.');
          const options = data as Record<string, unknown>;
          const allowed = request.url === '/api/ai/connect' ? ['profileId', 'newProfile', 'reconsent'] : [];
          if (Object.keys(options).some((key) => !allowed.includes(key))
            || (options.profileId !== undefined && (typeof options.profileId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.profileId)))
            || (options.newProfile !== undefined && typeof options.newProfile !== 'boolean')
            || (options.reconsent !== undefined && typeof options.reconsent !== 'boolean')
            || (options.newProfile && options.profileId)) throw new ApiError(400, 'INVALID_INPUT', '연결 요청 형식이 올바르지 않습니다.');
          if (request.url === '/api/ai/connect') { plan.beginSignIn(options); send(response, 202, { status: 'connecting' }); return; }
          if (request.url === '/api/ai/disconnect') await plan.disconnect();
          if (request.url === '/api/ai/recheck') await plan.recheck();
          if (request.url === '/api/ai/cancel') plan.cancelSignIn();
          send(response, 200, { status: 'ok' }); return;
        } catch (error) { throw planError(error); }
      }
      if (!['/api/explain', '/api/related'].includes(request.url || '')) {
        throw new ApiError(404, 'NOT_FOUND', '지원하지 않는 API입니다.');
      }
      if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.');
      const body = await readJson(request);
      const input = request.url === '/api/related' ? validateRelatedInput(body) : validateInput(body);
      if (active >= MAX_CONCURRENT_REQUESTS) throw new ApiError(429, 'SERVER_BUSY', '다른 설명을 처리 중입니다. 잠시 뒤 다시 시도해 주세요.');
      active++;
      try {
        if (request.url === '/api/related') {
          if (!related) throw new ApiError(503, 'NEWS_SEARCH_NOT_CONFIGURED', '관련 뉴스 검색에는 ChatGPT plan 연결이 필요합니다.');
          relatedStream = request.headers.accept === 'application/x-ndjson';
          if (relatedStream) response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const deadline = new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                const error = new ApiError(504, 'RELATED_TIMEOUT', '관련 뉴스 요청 시간이 초과됐습니다.');
                reject(error); controller.abort(error);
              }, config.relatedTimeoutMs ?? 120_000);
            });
            const result = await Promise.race([related(input as ReturnType<typeof validateRelatedInput>, controller.signal,
              relatedStream ? (stage) => streamLine({ stage }) : undefined), deadline]);
            if (!controller.signal.aborted) {
              if (relatedStream) { streamLine({ result }); response.end(); }
              else send(response, 200, result);
            }
          } finally { clearTimeout(timer); }
          return;
        }
        explanationStream = request.headers.accept === 'application/x-ndjson';
        if (explanationStream) response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
        let received = 0;
        const answer = await explain(input as ReturnType<typeof validateInput>, controller.signal, explanationStream ? (delta) => {
          received += delta.length;
          if (received > MAX_ANSWER_LENGTH) throw new ApiError(502, 'INVALID_LLM_RESPONSE', 'AI 응답이 너무 깁니다.');
          if (!controller.signal.aborted) streamLine({ delta });
        } : undefined);
        if (controller.signal.aborted) return;
        if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_ANSWER_LENGTH) {
          throw new ApiError(502, 'INVALID_LLM_RESPONSE', 'AI 응답을 읽지 못했습니다. 다시 시도해 주세요.');
        }
        if (explanationStream) { streamLine({ answer }); response.end(); }
        else send(response, 200, { answer });
      } finally { active--; }
    } catch (error) {
      // Never log request bodies, provider error bodies, selected text, or answers.
      const failure = error instanceof ApiError ? error : new ApiError(500, 'SERVER_ERROR', '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
      const body = { error: { code: failure.code, message: failure.message } };
      if (relatedStream || explanationStream) { streamLine(body); response.end(); }
      else send(response, failure.status, body);
    }
  });
}
