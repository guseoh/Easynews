import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
const code = buildSync({ entryPoints: ['src/explanation-view.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
const module = { exports: {} }; runInNewContext(code, { module, exports: module.exports });
const { explanationSections } = module.exports;

test('sentence structure separates known roles without interpreting markup', () => {
  const value = explanationSections('[누가]\n회사.\n\n[무엇을]\n매출 증가.\n\n[조건과 관계]\n<script>원문</script>\n\n[확인할 수 없음]\n주체 생략.');
  assert.deepEqual(Array.from(value, (section) => section.label), ['누가', '무엇을', '조건과 관계', '확인할 수 없음']);
  assert.equal(value[2].paragraphs[0], '<script>원문</script>');
});
test('fixed labels separate facts and general explanations while unknown content remains text', () => {
  const value = JSON.parse(JSON.stringify(explanationSections('[핵심 뜻]\n핵심.\n\n[기사에서 확인]\n확인.\n\n[일반적인 설명]\n일반 설명.\n\n[알 수 없는 제목]\n<script>text</script>')));
  assert.equal(value.length, 3);
  assert.equal(value[1].label, '기사에서 확인');
  assert.deepEqual(value[2].paragraphs, ['일반 설명.', '[알 수 없는 제목]\n<script>text</script>']);
  assert.deepEqual(JSON.parse(JSON.stringify(explanationSections('첫 문단\n\n다음 문단'))), [{ paragraphs: ['첫 문단', '다음 문단'] }]);
});
