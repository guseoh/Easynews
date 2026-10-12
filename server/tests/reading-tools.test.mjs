import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadingTools, ReadingToolsStream, TOOLS_MARKER } from '../dist/reading-tools.js';

const input = { mode: 'simple', selectedText: '매출은 늘고 영업이익은 줄었다.', articleTitle: '기사', readingTools: true };

test('split markers and optional JSON never leak into explanation drafts', () => {
  const text = '한국어 설명입니다.' + TOOLS_MARKER + JSON.stringify({ suggestedQuestions: ['매출과 이익은 어떻게 다른가요?'] });
  const stream = new ReadingToolsStream();
  let visible = '';
  for (const character of text) visible += stream.push(character);
  assert.equal(visible, '한국어 설명입니다.');
  assert.deepEqual(parseReadingTools(text, input), { answer: '한국어 설명입니다.', suggestedQuestions: ['매출과 이익은 어떻게 다른가요?'] });
});

test('ordinary paragraphs survive marker-prefix lookalikes and malformed optional tools', () => {
  const stream = new ReadingToolsStream();
  const text = '첫 문단\n\n[기사에서 확인]\n다음 문단';
  assert.equal(Array.from(text, (character) => stream.push(character)).join(''), text);
  assert.deepEqual(parseReadingTools('설명' + TOOLS_MARKER + '{', input), { answer: '설명' });
  assert.deepEqual(parseReadingTools('일반 설명', input), { answer: '일반 설명' });
  const result = parseReadingTools('설명' + TOOLS_MARKER + JSON.stringify({ suggestedQuestions: ['짧', '가'.repeat(301), 123, '이 문장의 뜻은 무엇인가요?', '이 문장의 뜻은 무엇인가요?'] }), input);
  assert.deepEqual(result.suggestedQuestions, ['이 문장의 뜻은 무엇인가요?']);
});

test('only exact source quotes support article facts; rewritten or invented evidence is dropped', () => {
  const current = { ...input, surroundingContext: '원재료 비용이 올랐다.' };
  const metadata = { evidence: [
    { quote: '매출은 늘고', source: 'selectedText' },
    { quote: '원재료 비용이 올랐다.', source: 'surroundingContext' },
    { quote: '매출이 증가했다.', source: 'selectedText' },
    { quote: '매출은 늘고', source: 'articleTitle' },
    { quote: '매출은 늘고', source: 'selectedText' },
  ] };
  const result = parseReadingTools('[기사에서 확인]\n기사의 사실.' + TOOLS_MARKER + JSON.stringify(metadata), current);
  assert.deepEqual(result.evidence, metadata.evidence.slice(0, 2));
  assert.equal(parseReadingTools('[일반적인 설명]\n일반 설명.' + TOOLS_MARKER + JSON.stringify(metadata), current).evidence, undefined);
});
