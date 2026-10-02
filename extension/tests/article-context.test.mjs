import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';

const code = buildSync({ entryPoints: ['src/article-context.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
const module = { exports: {} };
runInNewContext(code, { module, exports: module.exports, URL });
const { extractArticleContext, surroundingParagraphs, isArticleContext, httpUrl } = module.exports;

function documentFixture(overrides = {}) {
  const values = {
    'meta[property="og:title"]': '메타 기사 제목',
    'meta[property="og:type"]': 'article',
    'meta[property="og:site_name"]': '테스트 언론사',
    'meta[property="article:published_time"]': '2026-10-02T10:00:00+09:00',
    'meta[name="author"]': '테스트 기자',
    'link[rel="canonical"]': '/canonical', ...overrides,
  };
  const clone = { clone: true };
  return {
    title: 'document title', clone,
    cloneNode: () => clone,
    querySelector: (selector) => values[selector] ? { content: values[selector], getAttribute: () => values[selector] } : null,
  };
}

test('Readability parser receives a clone; metadata and bounded lead survive successful extraction', () => {
  const doc = documentFixture();
  const context = extractArticleContext(doc, 'https://news.example/current', (clone) => {
    assert.equal(clone, doc.clone);
    assert.notEqual(clone, doc);
    return { title: '추출 제목', textContent: '기사 문장. '.repeat(400) };
  });
  assert.equal(context.title, '추출 제목');
  assert.equal(context.canonicalUrl, 'https://news.example/canonical');
  assert.equal(context.siteName, '테스트 언론사');
  assert.equal(context.byline, '테스트 기자');
  assert.equal(context.publishedAt, '2026-10-02T10:00:00+09:00');
  assert.equal(context.textContent.length, 1200);
  assert.equal(context.extractionMethod, 'readability');
  assert.equal(context.confidence, 'high');
  assert.equal(isArticleContext(context, context.url), true);
});

test('Readability failure still returns metadata and document title fallback', () => {
  const doc = documentFixture({ 'meta[property="og:title"]': undefined });
  const context = extractArticleContext(doc, 'https://news.example/current', () => { throw Error('parse failure'); });
  assert.equal(context.title, 'document title');
  assert.equal(context.canonicalUrl, 'https://news.example/canonical');
  assert.equal(context.confidence, 'low');
  assert.equal(context.extractionMethod, 'fallback');
  assert.equal(context.textContent, undefined);
});

test('generic article DOM fallback and time metadata work without publisher selectors', () => {
  const doc = documentFixture({ 'meta[property="article:published_time"]': undefined });
  const originalQuery = doc.querySelector;
  doc.querySelector = (selector) => selector === 'article, [role="article"]'
    ? { querySelectorAll: () => [{ textContent: '공통 문단 '.repeat(100), closest: () => null }] }
    : selector === 'time[datetime]' ? { getAttribute: () => '2026-10-01' } : originalQuery(selector);
  const context = extractArticleContext(doc, 'https://news.example/current', () => null);
  assert.equal(context.extractionMethod, 'fallback');
  assert.equal(context.confidence, 'medium');
  assert.equal(context.publishedAt, '2026-10-01');
  assert.ok(context.textContent.length >= 200);
});

test('non-news prose and failed extraction degrade to metadata only', () => {
  const context = extractArticleContext(documentFixture({ 'meta[property="og:type"]': undefined, 'meta[property="article:published_time"]': undefined }), 'https://news.example/about', () => ({ textContent: '일반 웹 문서 '.repeat(100) }));
  assert.equal(context.confidence, 'low');
  assert.equal(context.textContent, undefined);
});

test('surrounding context prioritizes the selected paragraph and handles preceding/following edges', () => {
  assert.equal(surroundingParagraphs(['앞 문단', '선택 문장이 포함된 문단', '뒤 문단'], '선택 문장'), '앞 문단\n선택 문장이 포함된 문단\n뒤 문단');
  assert.equal(surroundingParagraphs(['선택', '뒤'], '선택'), '선택\n뒤');
  assert.equal(surroundingParagraphs(['앞', '선택'], '선택'), '앞\n선택');
  assert.equal(surroundingParagraphs(['본문'], '없는 문장'), '');
  assert.equal(surroundingParagraphs(['본문'], ''), '');
});

test('a long paragraph is bounded around the selection; oversized selection never expands context', () => {
  const context = surroundingParagraphs(['앞'.repeat(3000) + '선택 문장' + '뒤'.repeat(3000)], '선택 문장');
  assert.equal(context.length, 1600);
  assert.ok(context.includes('선택 문장'));
  assert.equal(surroundingParagraphs(['가'.repeat(8000)], '가'.repeat(8000)).length, 1600);
});

test('snapshot context rejects stale URLs, overlong text, unsafe canonical URLs and unknown data', () => {
  const valid = { title: '기사', url: 'https://news.example/a', confidence: 'high', extractionMethod: 'readability' };
  assert.equal(isArticleContext(valid, valid.url), true);
  for (const extra of [{ textContent: '가'.repeat(1201) }, { surroundingContext: '가'.repeat(1601) }, { canonicalUrl: 'javascript:alert(1)' }, { body: 'entire article' }, { confidence: 'certain' }]) {
    assert.equal(isArticleContext({ ...valid, ...extra }, valid.url), false);
  }
  assert.equal(isArticleContext(valid, 'https://news.example/b'), false);
  assert.equal(httpUrl('javascript:alert(1)'), undefined);
  assert.equal(httpUrl('https://user:password@news.example'), undefined);
});
