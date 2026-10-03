import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNews } from '../dist/news-grouping.js';
import { validateRelations } from '../dist/related-types.js';
const row = (index, options = {}) => ({ index, relation: 'follow_up', article: { title: `보도 ${index}`, url: `https://news.example/${index}`, source: `출처 ${index}`, publishedAt: '2026-10-03T10:00:00+09:00', relationReason: '새 진행' }, ...options });
test('verified copies share a card and distinct new developments remain first-class results', () => {
  const result = groupNews([row(0), row(1, { duplicateOf: 0 }), row(2), row(3, { duplicateOf: 1 })]);
  assert.equal(result.followUps.length, 2);
  assert.equal(result.followUps[0].alternatives.length, 2);
  assert.equal(result.followUps[1].title, '보도 2');
  assert.deepEqual(Object.keys(result.followUps[0].alternatives[0]).sort(), ['publishedAt', 'source', 'title', 'url']);
});
test('unknown dates, different relations and distant dates never merge', () => {
  const first = row(0);
  const unknown = row(1, { duplicateOf: 0 }); delete unknown.article.publishedAt;
  const later = row(2, { duplicateOf: 0 }); later.article.publishedAt = '2026-10-06T10:00:00+09:00';
  const background = row(3, { duplicateOf: 0, relation: 'background' });
  const result = groupNews([first, unknown, later, background]);
  assert.equal(result.followUps.length, 3); assert.equal(result.background.length, 1);
  assert.ok(result.followUps.every((article) => !article.alternatives));
});
test('copy references cannot be cyclic and alternative links respect source diversity', () => {
  for (const duplicateOf of [-1, 1, 2, '0']) assert.throws(() => validateRelations({ relations: [{ index: 0, relation: 'follow_up', relationReason: '진행', duplicateOf }] }, 1));
  const rows = [row(0), row(1, { duplicateOf: 0 }), row(2, { duplicateOf: 0 }), row(3)];
  rows.forEach((value) => { value.article.source = '동일 출처'; });
  const result = groupNews(rows);
  assert.equal(result.followUps.length, 2);
  assert.ok(result.followUps.every((article) => !article.alternatives));
});
