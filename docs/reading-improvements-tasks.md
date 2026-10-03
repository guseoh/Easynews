# Reading Improvements — task 순서

2026-10-03. 기존 Phase 1~4 위에 적용하는 읽기 개선 작업이다. 각 task 구현 후 관련 검증을 진행하고 다음 task로 넘어간다. 새 작업 전체의 설치 Chrome·실제 Plus QA는 별도로 확인한다.

| 순서 | 구분 | 구현 범위 | 주요 변경 파일 | 상태 |
|---|---|---|---|---|
| 1 | UI 개선 | 작게/보통 카드·섹션 밀도, 독립적인 본문 글자 설정 | extension/public/sidepanel.html, sidepanel.css; extension/src/sidepanel.ts | 구현 |
| 2 | 설명 개선 | 의미별 문단, 기사에서 확인/일반 설명/확인 불가 구분 | server/src/explain.ts; extension/src/explanation-view.ts, sidepanel.ts | 구현 |
| 3 | UX 개선 | 설명 점진 표시·중지, 관련 뉴스 0건 이유 | server/src/app.ts, openai.ts, chatgpt-plan.ts, response-stream.ts, related.ts; extension/src/explanation.ts, related-news.ts | 구현 |
| 4 | 추천 개선 | 후속의 새로운 점·배경의 이해 도움을 구체적으로 표시 | server/src/related-llm.ts; extension/src/sidepanel.ts | 구현 |
| 5 | 추가 기능 | 용어·수치 집중 설명, 깊이, 현재 문장 추가 질문, 원문 위치 이동 | server/src/explain.ts, openai.ts; extension/src/explanation.ts, content.ts, sidepanel.ts; extension/tsconfig.json | 구현 |
| 6 | 탐색 개선 | 같은 진행을 반복 보도한 후보 묶기 | server/src/news-grouping.ts, related.ts, related-types.ts, related-llm.ts; extension/src/related-news.ts, sidepanel.ts | 구현 |
| 7 | 접근성 개선 | 패널 열기·설명 모드·원문 이동 단축키 | extension/manifest.json; extension/src/background.ts, content.ts, sidepanel.ts | 구현 |

관련 회귀/신규 검증 파일: extension/tests/background.test.mjs, explanation.test.mjs, explanation-view.test.mjs; server/tests/explain.test.mjs, related.test.mjs, news-grouping.test.mjs. README에서 이 task 문서를 연결한다.

## 동작과 데이터 경계

- 기본 화면 밀도와 본문 글자는 작게다. 테마·화면 밀도·본문 글자 선호값만 로컬 저장한다.
- 설명 요청은 기존 선택 문장 2,000자·제목 300자·필요한 주변 문맥 1,600자 제한을 유지한다. 집중할 용어/수치는 선택 문장에 포함된 120자 이내 문자열이며, 추가 질문은 300자 이내다. 이전 AI 답변·질문 이력·기사 전문은 요청하지 않는다.
- 짧게는 3~6문장, 자세히는 필요한 단계와 근거를 최대 10문장으로 설명하도록 요청한다. 사실/일반 설명 구분은 AI가 작성하며 별도의 사실 검증을 의미하지 않는다. 모델이 정해진 라벨을 쓰지 않으면 일반 문단으로 안전하게 표시한다.
- 설명 스트림은 임시 답변이다. Provider의 completed 검증 후에만 최종 답변으로 표시하며 오류·중지·선택 변경·기사 이동·패널 종료 시 임시 답변을 제거한다. API Key Provider도 Responses SSE의 response.completed를 요구한다.
- 관련 뉴스 0건은 검색 결과 없음·관련 후보 없음·직접 관계 없음·날짜 확인 불가·관계 판정 실패로 구분한다. 오류 응답은 별도로 안내한다.
- 추천 이유에는 제목·metadata·이미 얻은 최대 240자 검색 발췌만 사용하며 본문을 추가 수집하지 않는다. 같은 진행 판정이 있는 후보만 시간 검증 후 묶는다. 날짜가 불명확하거나 24시간 넘게 떨어져 있거나 관계 유형이 다르면 묶지 않는다. 최대 4개 대표 카드와 카드당 최대 3개 다른 보도 링크를 표시하며 링크도 출처당 2개 제한을 따른다. 별개의 새 진행은 별도 카드로 남는다.
- 원문 위치는 현재 문서의 DOM Range만 메모리에 둔다. DOM이 바뀌거나 선택이 일치하지 않으면 이동을 중단하고 재선택을 안내한다. 강조 표시와 임시 포커스 속성도 정리한다.
- 기본 단축키: Alt+Shift+E 패널 열기, Alt+Shift+1/2/3 설명 모드, 패널의 Alt+Shift+0 원문으로 포커스 이동. Chrome에서 키가 이미 사용 중이면 설정에서 재할당해야 한다. 입력창·선택 상자에서 타이핑 중이면 패널의 설명 단축키를 처리하지 않는다.
- 기사·선택·질문·답변·추천은 파일/DB/캐시/브라우저 동기화 저장소에 장기 저장하거나 로그에 출력하지 않는다. store:false와 기존 인증·DPAPI 보호 정책을 유지한다.

## 설치 Chrome / 실제 Plus 확인 목록

자동 검증: `npm run typecheck`, `npm run build`, `npm test`, `git diff --check` 통과. 전체 141개 중 140개 통과·1개 Windows 환경에서 POSIX 파일 권한 테스트 skip(확장 32/32, 서버 63/63, SDK 45/46). 실제 기사·사용자 질문·AI 답변을 검증 로그에 출력하지 않았다.

1. 확장과 기사 페이지를 새로고침한 뒤 작게/보통을 번갈아 선택해 카드·섹션 크기와 독립적인 본문 글자 설정 확인.
2. 세 설명 모드에서 실제 문단·라벨·내용 구분 확인. 자세히/짧게, 용어·수치 집중 설명, 추가 질문 확인.
3. 점진 표시 중 중지·다른 문장 선택·기사 이동·패널 종료 후 답변 및 요청 제거 확인.
4. 원문 위치 이동과 잠시 강조, DOM이 변경된 경우 안전한 실패 안내 확인.
5. 단축키로 활성 창의 선택만 설명하고 입력창 작성 중에는 요청이 실행되지 않는지 확인.
6. 관련 뉴스의 새로운 점/배경 도움·0건 이유·반복 보도 묶음·원문 링크 확인. 미확인 날짜를 후속으로 노출하지 않는지 확인.

자동 검증 결과와 실제 QA를 혼동하지 않는다. 이 wave의 실제 Plus 품질 및 설치 Chrome QA는 아직 미검증이다.
