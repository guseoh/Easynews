# Phase 3 — Article Context 검증

검증일: 2026-10-02 (Asia/Seoul). 구현·자동 검증·Chrome fixture 검증 완료, 설치 확장의 언론사별 수동 QA는 대기합니다.

## 구현과 데이터 경계

- [Mozilla Readability](https://github.com/mozilla/readability)의 공식 clone 사용법에 따라 복제 DOM을 분석합니다. 추출 HTML은 표시·전송하지 않습니다.
- 공통 Readability → metadata → article/role=article의 문단 fallback 순서입니다. 언론사 전용 selector는 없습니다.
- 제목 300자, URL 2,048자, 출처·기자 120자, 발행 시간 80자, 도입부 1,200자, 선택 주변 문맥 1,600자로 제한합니다.
- 추출 전문은 로컬 함수 실행 중에만 존재합니다. 세션에는 제한된 도입부와 metadata·주변 문맥만 있으며 페이지 이동·탭 전환·패널 종료 시 기존 수명 정책으로 제거합니다.
- 설명 요청에는 제목·선택 문장·선택 주변 문맥만 전달합니다. 도입부·URL·전문은 설명 서버가 받지 않습니다. 서버가 주변 문맥 길이를 다시 검증하고 프롬프트에서도 신뢰하지 않는 데이터로 취급합니다.
- 비기사 또는 낮은 신뢰도는 metadata만 반환하고 패널에 문맥 부족을 표시합니다. 선택 문장 설명은 계속 사용할 수 있습니다.
- DB·본문 파일·영속 캐시·읽기 기록·학습 기록은 추가하지 않았습니다.

## 검증 결과

- `npm run typecheck`: extension·server 통과.
- `npm run build`: extension·server 통과.
- `npm test`: extension 17개 중 최초 서비스 워커 mock의 `URL` 누락으로 2개 실패, server 10개 통과. mock을 보완하고 `cd extension; node --test tests/background.test.mjs`로 해당 5개를 재검증해 모두 통과. 총 **27개 유효한 통과 결과**입니다.
- Node 테스트: clone 전달, 제목·canonical·출처·기자·발행 시각, 실패 fallback, 비기사, 앞뒤 문단, 긴 선택·문맥 제한, 안전한 URL과 snapshot 검증, 기존 수명 정책, 최소 설명 요청을 확인했습니다.
- Chrome 실제 DOM fixture: **9개 통과**. 실제 Readability 성공, 원본 DOM 보존, metadata, 도입부 제한, 강제 parser 실패 fallback, 주변 문단, 1,600자 제한, 비기사, 위험한 canonical 배제를 확인했습니다.
- Chrome 결과 화면: `.qa/phase3-context.png` (합성 데이터만 사용, Git 제외).

fixture 재실행: 빌드 후 `node extension/scripts/ui-qa.mjs`, Chrome에서 `http://127.0.0.1:3101/article-qa`를 열고 **문맥 테스트 실행**을 누릅니다. 외부 사이트/API를 호출하지 않습니다. Node의 DOM mock 검증과 Chrome 실제 Readability 검증을 구분합니다.

## 실제 Chrome 수동 QA 목록

확장을 새로고침하고 기사 페이지도 새로고침한 뒤 확장 아이콘으로 실행합니다. 아래는 **미실행** 항목이며 fixture 성공으로 대신 완료 처리하지 않습니다.

| 사이트 | 확인 항목 | 상태 |
| --- | --- | --- |
| 네이버 뉴스 | 제목·출처·날짜, 선택 문단과 앞뒤 문맥 | 대기 |
| 한국경제 | 동일 항목, DOM·화면 유지 | 대기 |
| 매일경제 | 동일 항목, 광고·메뉴 문맥 제외 | 대기 |
| 연합뉴스 | 동일 항목, canonical과 기자 metadata | 대기 |
| 일반 비기사 페이지 | 문맥 부족 안내와 선택 문장 설명 유지 | 대기 |

각 사이트에서 기사·탭 이동과 패널 종료 후 이전 문맥이 제거되는지 확인합니다. 페이지가 제한되거나 추출 신뢰도가 낮으면 metadata만 제공되는 것이 허용되는 동작입니다. 원문·선택 문장·AI 답변을 QA 문서에 붙여 넣지 않습니다.

실제 OpenAI API를 통한 주변 문맥 포함 설명 품질은 사용자의 최신 안내에 따라 크레딧 미충전으로 보류합니다. 문맥 추출과 fixture QA에는 API 키가 필요 없습니다. Phase 4 구현을 차단하지 않습니다.
