import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createMetadataEnricher, parseNewsMetadata } from '../dist/news-metadata.js';
import { publicAddress, resolvePublicPage, readPublicPage } from '../dist/public-page.js';

const date = '2026-10-02T10:00:00+09:00'; const iso = '2026-10-02T01:00:00.000Z';
const signal = () => new AbortController().signal;
test('generic article JSON-LD has priority and returns only title, publisher and verified publication time', () => {
  const html = `<meta property="article:published_time" content="2026-10-01T00:00:00Z"><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'Organization', datePublished: '2000-01-01T00:00:00Z' }, { '@type': 'NewsArticle', headline: '기사 &amp; 제목', datePublished: date, dateModified: '2026-10-03T00:00:00Z', publisher: { name: '언론사' }, articleBody: 'private body' }] })}</script>`;
  assert.deepEqual(parseNewsMetadata(html), { title: '기사 & 제목', source: '언론사', publishedAt: iso });
});
test('OG, ordinary name/property meta and time datetime cover publication dates without publisher selectors', () => {
  for (const key of ['article:published_time', 'pubdate', 'dc.date.issued', 'parsely-pub-date']) {
    const parsed = parseNewsMetadata(`<meta content='${date}' property='${key}'><meta content="제목" name="og:title"><meta property="og:site_name" content="출처">`);
    assert.deepEqual(parsed, { title: '제목', source: '출처', publishedAt: iso });
  }
  assert.equal(parseNewsMetadata(`<time datetime="${date}">기사 날짜</time>`).publishedAt, iso);
  assert.equal(parseNewsMetadata(`<meta name=pubdate content="${date}">`).publishedAt, iso);
});
test('invalid, missing, date-only, timezone-free and modified dates are never guessed', () => {
  for (const value of ['invalid', '2026-02-30T10:00:00Z', '2026-10-02', '2026-10-02T10:00:00']) assert.equal(parseNewsMetadata(`<meta property="article:published_time" content="${value}">`).publishedAt, undefined);
  assert.deepEqual(parseNewsMetadata('<p>기사 본문에 2026년 10월 2일이 나와도 추측하지 않는다.</p>'), {});
  assert.equal(parseNewsMetadata(`<meta property="article:modified_time" content="${date}">`).publishedAt, undefined);
  assert.equal(parseNewsMetadata(`<script type="application/ld+json">malformed</script><time datetime="${date}"></time>`).publishedAt, iso);
});
test('metadata enrichment is bounded to three parallel page reads, tolerates failures and propagates cancellation', async () => {
  let active = 0; let max = 0;
  const rows = Array.from({ length: 12 }, (_, index) => ({ title: '검색 제목', url: `https://publisher.example/${index}`, source: 'publisher.example', publishedAt: 'untrusted' }));
  const enrich = createMetadataEnricher(async (url) => {
    active++; max = Math.max(active, max); await new Promise((resolve) => setTimeout(resolve, 1)); active--;
    if (url.endsWith('/0')) throw Error('private page text');
    return `<meta property="og:title" content="확인 제목"><meta property="article:published_time" content="${date}">`;
  });
  const enriched = await enrich(rows, signal()); assert.ok(max <= 3); assert.equal(enriched.length, 12);
  assert.equal(enriched[0].publishedAt, undefined); assert.equal(enriched[0].title, '검색 제목'); assert.equal(enriched[1].publishedAt, iso);
  assert.equal(enriched[1].title, '확인 제목'); assert.equal(JSON.stringify(enriched).includes('private'), false);
  const controller = new AbortController(); controller.abort(); await assert.rejects(enrich(rows, controller.signal));
});
test('metadata egress rejects private/reserved IPv4, local/mapped IPv6, credentials, custom ports and private DNS', async (t) => {
  for (const ip of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true); assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://127.0.0.1/a', 'http://[::1]/a', 'https://user:pass@publisher.example/a', 'file:///private', 'http://8.8.8.8:3000/a']) await assert.rejects(resolvePublicPage(url, signal()));
  const mock = t.mock.method(dns, 'lookup', async () => [{ address: '10.0.0.1', family: 4 }]); syncBuiltinESMExports();
  await assert.rejects(resolvePublicPage('https://private.example/a', signal())); mock.mock.restore(); syncBuiltinESMExports();
});
test('metadata sockets use validated IP, carry no credentials and revalidate redirects before following', async (t) => {
  let calls = 0;
  const dnsMock = t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const httpMock = t.mock.method(https, 'request', (url, options, respond) => {
    calls++; assert.equal(url.hostname, 'publisher.example'); assert.equal(options.agent, false);
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    options.lookup('publisher.example', { all: false }, (_error, address) => assert.equal(address, '8.8.8.8'));
    const request = new EventEmitter(); request.end = () => {
      const response = Readable.from([]); response.statusCode = 302; response.headers = { location: 'http://127.0.0.1/private' };
      respond(response);
    }; return request;
  }); syncBuiltinESMExports();
  try { await assert.rejects(readPublicPage('https://publisher.example/a', signal())); assert.equal(calls, 1); }
  finally { dnsMock.mock.restore(); httpMock.mock.restore(); syncBuiltinESMExports(); }
});
