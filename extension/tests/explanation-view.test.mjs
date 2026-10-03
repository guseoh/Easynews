import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
const code = buildSync({ entryPoints: ['src/explanation-view.ts'], bundle: true, write: false, format: 'cjs' }).outputFiles[0].text;
const module = { exports: {} }; runInNewContext(code, { module, exports: module.exports });
const { explanationSections } = module.exports;
test('fixed labels separate facts and general explanations while unknown content remains text', () => {
  const value = JSON.parse(JSON.stringify(explanationSections('[핵심 뜻]\n핵심.\n\n[기사에서 확인]\n확인.\n\n[일반적인 설명]\n일반 설명.\n\n[알 수 없는 제목]\n<script>text</script>')));
  assert.equal(value.length, 3);
  assert.equal(value[1].label, '기사에서 확인');
  assert.deepEqual(value[2].paragraphs, ['일반 설명.', '[알 수 없는 제목]\n<script>text</script>']);
  assert.deepEqual(JSON.parse(JSON.stringify(explanationSections('첫 문단\n\n다음 문단'))), [{ paragraphs: ['첫 문단', '다음 문단'] }]);
});
