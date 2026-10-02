import { extractArticleContext, selectionContext, surroundingParagraphs } from '../src/article-context';

const results = document.querySelector('#qa-results')!;
const prose = '한국은행은 물가와 가계대출 상황을 살펴 기준금리를 결정한다. 금융시장에서는 발표 이후 채권과 환율의 변화를 확인한다. '.repeat(10);
function fixture(extra = '', body = `<article><h1>한국은행 기준금리 결정</h1><p>${prose}</p><p>선택 문장을 이해하는 핵심 문단입니다.</p><p>뒤 문단입니다.</p></article>`) {
  return new DOMParser().parseFromString(`<html><head><title>한국은행 기준금리 결정</title><meta property="og:type" content="article"><meta property="og:site_name" content="테스트 언론사"><meta name="author" content="테스트 기자"><meta property="article:published_time" content="2026-10-02T10:00:00+09:00"><link rel="canonical" href="https://news.example/canonical">${extra}</head><body>${body}</body></html>`, 'text/html');
}
document.querySelector('button')!.addEventListener('click', () => {
  results.replaceChildren();
  const check = (name: string, work: () => boolean) => {
    const row = document.createElement('li');
    try { row.textContent = `${work() ? 'PASS' : 'FAIL'} — ${name}`; }
    catch { row.textContent = `FAIL — ${name}`; }
    results.append(row);
  };
  const doc = fixture();
  const original = doc.documentElement.outerHTML;
  const context = extractArticleContext(doc, 'https://news.example/current');
  check('Readability 실제 파서 성공', () => context.extractionMethod === 'readability' && context.confidence === 'high');
  check('원본 DOM 불변', () => doc.documentElement.outerHTML === original);
  check('제목·canonical·siteName·byline·날짜', () => context.title.includes('한국은행') && context.canonicalUrl === 'https://news.example/canonical' && context.siteName === '테스트 언론사' && context.byline === '테스트 기자' && !!context.publishedAt);
  check('도입부 제한', () => !!context.textContent && context.textContent.length <= 1200);
  const fallback = extractArticleContext(doc, 'https://news.example/current', () => { throw new Error(); });
  check('Readability 실패 시 공통 article fallback', () => fallback.extractionMethod === 'fallback' && fallback.confidence === 'medium');
  const selected = selectionContext(doc, '선택 문장');
  check('선택 문단과 앞뒤 문단', () => selected.includes('선택 문장') && selected.includes('한국은행') && selected.includes('뒤 문단'));
  check('주변 문맥 1600자 제한', () => surroundingParagraphs(['앞'.repeat(4000) + '선택' + '뒤'.repeat(4000)], '선택').length === 1600);
  const nonArticle = new DOMParser().parseFromString('<title>일반 페이지</title><nav><a href="/">홈</a></nav><p>서비스 안내</p>', 'text/html');
  const minimal = extractArticleContext(nonArticle, 'https://news.example/about');
  check('비기사 페이지 metadata만 반환', () => minimal.confidence === 'low' && minimal.title === '일반 페이지' && !minimal.textContent);
  const unsafe = fixture('<link rel="canonical" href="javascript:alert(1)">');
  unsafe.querySelector('link')!.remove();
  check('위험한 canonical 제외', () => !extractArticleContext(unsafe, 'https://news.example/current').canonicalUrl);
});
