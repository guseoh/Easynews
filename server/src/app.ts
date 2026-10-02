import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ApiError, validateInput, MAX_ANSWER_LENGTH } from './explain.js';
import type { Explain } from './openai.js';

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

export function createApp(config: { extensionId: string }, explain: Explain) {
  let active = 0; // A count only; no request text or response cache is retained.
  const origin = `chrome-extension://${config.extensionId}`;
  return createServer(async (request, response) => {
    const controller = new AbortController();
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
      if (request.method === 'OPTIONS' && request.url === '/api/explain' && request.headers.origin === origin) {
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, X-Easynews-Extension',
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      if (request.headers['x-easynews-extension'] !== config.extensionId) {
        throw new ApiError(403, 'FORBIDDEN_CLIENT', '서버에 설정한 Easynews 확장 ID를 확인해 주세요.');
      }
      if (request.url !== '/api/explain') {
        throw new ApiError(404, 'NOT_FOUND', '지원하지 않는 API입니다.');
      }
      if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.');
      const input = validateInput(await readJson(request));
      if (active >= MAX_CONCURRENT_REQUESTS) throw new ApiError(429, 'SERVER_BUSY', '다른 설명을 처리 중입니다. 잠시 뒤 다시 시도해 주세요.');
      active++;
      try {
        const answer = await explain(input, controller.signal);
        if (controller.signal.aborted) return;
        if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_ANSWER_LENGTH) {
          throw new ApiError(502, 'INVALID_LLM_RESPONSE', 'AI 응답을 읽지 못했습니다. 다시 시도해 주세요.');
        }
        send(response, 200, { answer });
      } finally { active--; }
    } catch (error) {
      // Never log request bodies, provider error bodies, selected text, or answers.
      const failure = error instanceof ApiError ? error : new ApiError(500, 'SERVER_ERROR', '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
      send(response, failure.status, { error: { code: failure.code, message: failure.message } });
    }
  });
}
