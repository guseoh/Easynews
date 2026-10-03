# Phase 4 — Related News 검증

현재 구현과 실제 Plus QA는 [2026-10-03 Web search 전환 QA](phase-4-web-search-qa.md)를 참조하세요. 아래는 전환 전 NAVER mock 검증의 역사 기록이며 현재 서버에 NAVER 키는 필요하지 않습니다.

검증일: 2026-10-02 (Asia/Seoul). 구현·자동 검증·mock Chrome QA 완료. 실제 API와 설치 확장의 언론사별 QA는 대기합니다.

## 구현 내용

현재 기사 → Event Fingerprint → 최대 3개 query → NAVER 뉴스 검색 → HTML·metadata 정규화 → 현재 기사·중복 제거 → deterministic ranking → 상위 12개 → 관계 판정 → 시간 강제 검증 → 출처 다양성 → followUps / background.

- [NAVER 공식 뉴스 검색 문서](https://developers.naver.com/docs/serviceapi/search/news/news.md)를 확인했습니다. 서버만 HTTPS 뉴스 검색 JSON API를 호출하며 각 query는 display=20, start=1, sort=sim으로 요청합니다. 인증 정보는 서버 환경변수 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`에만 둡니다.
- OpenAI 설정이 있으면 사건 특징·관계를 두 번 이내 호출로 판정합니다. [공식 Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)의 `text.format` JSON schema·strict와 별도 runtime validation을 함께 사용하고 `store:false`를 유지합니다.
- OpenAI 설정이 없으면 보수적인 제목·시간 규칙을 사용하고 `RULE_BASED`를 안내합니다. 특징 생성 실패는 fallback query, 관계 판정 실패는 fallback 관계와 별도 안내로 처리합니다. 검색 설정 누락·권한·HTTP 실패·네트워크·시간초과·잘못된 응답·문맥 부족은 각각 구분합니다.
- ranking 가중치는 `server/src/news-ranking.ts`의 `RANKING`에 모았습니다. 제목의 사건 키워드·주체·기관·인물·시간 근접성을 사용하고 주체만 같은 다른 주제는 제거합니다.
- URL·original URL·tracking 제거 URL·정규화 제목·높은 제목 유사도로 중복과 현재 기사를 제외합니다. NAVER oid/aid와 desktop/mobile article 경로도 같은 기사로 취급합니다.
- 현재·후보의 유효한 시각이 있고 후보가 나중인 경우만 follow_up을 허용합니다. 같거나 과거인 follow_up, 미래의 background는 related로 낮추고 노출하지 않습니다. 날짜만 있거나 파싱 실패는 unknown이며, 시각 미확인 background에는 안내를 붙입니다.
- 결과는 각 그룹 최대 4개, 출처당 최대 2개입니다. 부족한 그룹을 related/irrelevant로 채우지 않습니다. 출처는 원문 URL의 hostname이며 검색 API가 언론사 이름을 제공하지 않는 경우도 출처를 꾸며내지 않습니다.
- 결과는 제목·원문 링크·출처·날짜·최대 180자 관계 이유만 제공합니다. API description은 짧게 정규화해 관계 판정에만 사용하고 UI·응답에 포함하지 않습니다. 원문 URL이 제공되면 언론사 링크를 우선합니다.
- 설명과 관련 뉴스는 요청·로딩·오류·재시도가 독립적입니다. 선택 변경은 설명만 정리하고, 기사·탭 이동과 패널 종료는 두 기능 모두 취소·정리합니다.

## API와 데이터 경계

`POST /api/related`는 title(300자), url/canonicalUrl(각 2,048자), siteName(120자), publishedAt(80자), textContent(최대 1,200자 도입부)만 받습니다. 최소 도입부 80자와 기사 제목이 필요합니다. 전문·선택 문장·주변 문맥·history·추가 필드는 거부합니다. 확장 ID·Origin·루프백 Host·JSON 16,384 bytes·동시 요청 2개의 기존 제한을 두 API에 적용합니다.

기사 발췌·fingerprint·검색 후보·판정은 요청 중 메모리에만 있습니다. 결과는 패널의 DOM·메모리에만 두고 browser storage에 저장하지 않습니다. DB·파일·캐시·읽기 기록·계정·노트·전체 요약·클라우드 인프라는 추가하지 않았습니다. 캐시는 복잡도와 데이터 수명을 늘리지 않도록 이번 구현에서 생략했습니다. 자동 검색이나 재시도는 없고 사용자의 버튼 클릭으로만 호출합니다.

외부 공급자 정책은 로컬 저장 금지와 별개이며 `store:false`는 공급자 전체의 Zero Data Retention 보장이 아닙니다. API 입력·응답·공급자 원본 오류와 키를 로그로 남기지 않습니다. QA 자료에는 합성 데이터만 사용했습니다.

## 자동 검증

- `npm run typecheck`: extension·server 통과. 마지막 패널 보완 후 `npm run typecheck --workspace extension`도 통과.
- `npm run build`: extension·server 통과. 마지막 패널 보완 후 `npm run build --workspace extension`도 통과.
- `npm test`: extension 20개·기존 server 설명 10개 통과. 새 related 테스트 1개는 정상 trim과 기대값의 차이로 실패했습니다. 기대값을 보완하고 날짜·검색 오류 처리 검증을 추가한 뒤 `cd server; node --test tests/related.test.mjs` **20개 모두 통과**. 총 **50개의 유효한 통과 결과**를 확보했으며 성공한 기존 테스트는 반복하지 않았습니다.
- 검증 범위: fingerprint schema·fallback query, HTML entity, URL tracking·NAVER URL, exact/near duplicate·현재 기사 제외, entity/keyword ranking·12개 제한, 날짜·과거/같은 시각/unknown 후속 차단, 출처 다양성·4개 제한, irrelevant 제외, reason schema, NAVER 설정·HTTP·네트워크·timeout·형식 오류, LLM strict 요청·실패·timeout·취소, 빈 결과, no-store HTTP API·Origin·독립 설명 기능.
- 외부 NAVER/OpenAI는 모두 mock입니다. 실제 HTTP 서버와 요청 검증·파이프라인은 사용합니다.

## Chrome mock QA

빌드 후 `node extension/scripts/ui-qa.mjs`, Chrome에서 `http://127.0.0.1:3101/`을 엽니다. 빌드된 패널 HTML·CSS·JS를 사용하며 Chrome API·현재 기사 snapshot·외부 API만 합성 데이터로 대체합니다. 관련 요청은 루프백 proxy를 통해 실제 서버의 `/api/related`·NAVER 어댑터·OpenAI 어댑터·전체 ranking/관계 파이프라인을 실행합니다. 실제 키·외부 요청·뉴스 원문은 사용하지 않습니다.

| 항목 | 결과 |
| --- | --- |
| 명시 요청·최소 입력 | 초기 요청 0; 버튼 클릭만 호출, 선택·주변 문맥 없이 6개 제한된 metadata/도입부 필드 전송 |
| 두 그룹 | 후속·배경에 제목·출처·날짜·짧은 관계 이유·원문 링크 표시 |
| 시간·주제 제외 | 과거·시각 미확인 후보와 주체만 같은 채용 후보가 후속에 표시되지 않음 |
| 기사 A → B | 원문 읽기로 B 합성 페이지가 새 탭에 열리고 B 제목·URL·시각으로 패널 갱신 |
| B 재탐색 | B 자신을 제외하고 다음 후속 C와 배경을 탐색 가능 |
| 설명 유지 | B에서 왜 그런가·쉽게 설명·배경 설명 정상; HTML 형태 응답도 일반 텍스트 |
| 선택 변경 | 설명만 제거, 관련 결과 유지, 자동 요청 없음 |
| 검색 0건 | 빈 결과 안내, 개수 채우기 없음 |
| LLM 실패 | 특징·관계 fallback 안내와 보수적 결과 |
| 검색 설정 누락 | 별도 설정 안내·재시도, 설명 정상 |
| 검색 API 실패 | 별도 검색 실패 안내·재시도 |
| 수동 재시도 | 설정/오류 해소 후 관련 결과 정상, 기존 설명 유지 |
| 설명 오류 | AI 한도 안내, 기존 관련 결과 유지 |
| loading | 진행 안내·관련 버튼 비활성, 설명 버튼 독립 |
| 기사 이동 | 이전 기사·선택·설명·관련 상태 제거, 늦은 관련 응답도 차단 |
| 패널 종료 이벤트 | 모든 임시 표시·요청 정리, 늦은 관련 응답 차단 |
| 문맥 부족 | 관련 검색 비활성, 설명은 제목·선택 문장만 전송해 정상 동작. 이 QA에서 발견한 잔여 주변 문맥 전송을 보완하고 재검증 |
| 실제 로컬 서버 중단 | 연결 오류·재시도 표시 |

결과 화면은 `.qa/phase4-related.png`(합성 데이터, Git 제외)입니다. 검증 후 임시 서버와 QA 탭을 닫았습니다. 이 결과는 **mock Chrome QA**이며 설치된 확장의 권한·Side Panel 수명·실제 기사 추출·추천 품질을 대신 완료 처리하지 않습니다.

## 실제 API·설치 확장 QA 대기

- OpenAI: 사용자 안내의 크레딧 미충전으로 실제 fingerprint·관계 판정·주변 문맥 설명 품질 보류.
- NAVER: 이번 작업에서는 실제 인증 정보로 호출하지 않았습니다. 실제 인증·쿼리 품질·검색 후보·원문 URL의 정확성은 미검증입니다.
- 네이버 뉴스·한국경제·매일경제·연합뉴스: 확장 재로드와 기사 새로고침 후 제목·canonical·출처·시각·문맥 신뢰도, 후속·배경 품질, 언론사 링크, 이동·탭 전환·종료 시 정리를 각각 수동 확인합니다.
- 실제 A → B: 관련 결과에서 B 원문을 새 탭으로 열고, **B 탭에서 확장 아이콘을 눌러 `activeTab` 접근을 부여**한 뒤 B의 새 정보로 재탐색합니다. 사이트 상시 접근 권한은 추가하지 않아 새 탭·다른 출처 기사에 자동으로 권한을 부여하지 않습니다. mock의 snapshot 갱신을 실제 확장 자동 캡처 성공으로 간주하지 않습니다.

기사 전문·선택·AI 답변·키를 QA 문서나 로그에 기록하지 않습니다. 실제 API QA 보류는 구현 blocker가 아니지만 실뉴스 추천 품질은 해당 QA 전까지 확정하지 않습니다.
