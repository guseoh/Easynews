# Easynews 구조와 제품 경계

Easynews는 현재 기사의 이해와 다음 기사 탐색을 돕습니다. 기사 원문을 저장·재배포하지 않고, 사용자가 현재 읽는 기사에서 요청한 최소한의 텍스트·메타데이터만 일시 처리합니다. 관련 뉴스는 제목·출처·링크 중심으로 제공하며, 원문은 항상 언론사 페이지에서 읽습니다. 기사 저장, 사용자 정리, 학습 기록, 지식 축적은 제품의 역할이 아닙니다. 정리는 사용자가 외부 도구에서 직접 작성합니다.

## 실행 흐름

1. 사용자가 기사에서 문장을 선택하고 확장 아이콘 또는 단축키를 실행합니다.
2. 서비스 워커가 사용자 제스처 안에서 Side Panel을 열고 `activeTab` 권한으로 최상위 문서에 `content.js`를 주입합니다.
3. 콘텐츠 스크립트가 복제 DOM으로 기사 문맥을 추출해 제목·URL·선택 문장·제한된 도입부·주변 문맥을 보냅니다. 이후 선택 변경은 짧게 지연해 갱신합니다.
4. 서비스 워커가 메시지 발신자·최상위 프레임·스키마·현재 URL을 검증합니다. 탭별 작업을 직렬화해 뒤늦은 메시지가 삭제한 상태를 복원하지 않게 합니다.
5. 패널이 현재 탭의 세션 상태를 읽고 선택 문장을 `textContent`로 표시합니다.
6. 탭·페이지 이동 또는 패널 종료 시 임시 상태를 지우고 감지 스크립트를 중지합니다. 다시 사용하려면 확장 아이콘을 누릅니다.

`chrome.storage.session`은 서비스 워커의 메모리 수명과 패널 초기화 순서에 화면 상태가 종속되지 않게 하는 임시 전달 수단입니다. 읽은 기사 이력이나 저장 목록으로 사용하지 않습니다. 패널 연결은 `runtime.Port`로 추적하며, 브라우저가 워커 연결을 종료하면 열린 패널이 다시 연결합니다.

## 의도적인 제한

- Phase 1은 본문 추출·기사 판별·외부 API 호출을 하지 않습니다.
- 정적 콘텐츠 스크립트와 상시 사이트 접근 권한을 두지 않습니다.
- 선택이 비면 마지막 문장을 유지해 패널 클릭 시 읽던 내용이 사라지지 않게 합니다. 이동·종료 시에는 삭제합니다.
- 입력·편집 영역, 하위 iframe, PDF 선택은 지원하지 않습니다.
- 선택 내용은 최대 8,000자이며 잘림 여부를 화면에 표시합니다.
- 뉴스 페이지마다 전용 DOM selector를 추가하지 않습니다.

## Phase 2 — AI Explanation

설명 버튼을 누를 때만 패널에서 `POST http://127.0.0.1:3000/api/explain`을 호출합니다. 입력은 `mode`(`simple`, `why`, `background`), `selectedText`(1~2,000자), `articleTitle`(선택, 최대 300자), Phase 3의 선택적 `surroundingContext`(최대 1,600자)입니다. 기사 URL·전문·도입부는 보내지 않습니다. 낮은 문맥 신뢰도는 주변 문맥도 제외합니다. 응답은 `{ "answer": "..." }`이며 실패하면 `{ "error": { "code": "...", "message": "..." } }`를 반환합니다.

서버는 Node.js의 `http`와 `fetch`만 사용하며 `127.0.0.1`에 바인딩합니다. 설정한 확장 ID·Origin과 루프백 Host만 허용하고 JSON 크기를 제한합니다. API 키는 서버 환경변수에만 있습니다. 요청·답변 로그, DB, 파일 저장, 캐시, 대화 이력은 두지 않습니다. 잘못된 필드·본문 전달 요청은 LLM 호출 전에 거부합니다.

OpenAI Responses API는 `store: false`, 제한된 출력 길이, 별도 세 모드 지시문을 사용합니다. 선택 내용 속 명령을 데이터로 취급하고 전체 기사 요약·노트 대필을 하지 않도록 지시합니다. 이 지시문만으로 실제 답변 품질을 보장하지 않으며 실뉴스 QA가 필요합니다. 타임아웃·rate limit·거부·불완전 응답을 검증하고 공급자의 원본 오류를 노출하지 않습니다.

선택·기사·탭이 바뀌거나 패널이 종료되면 fetch를 취소하고 답변을 지웁니다. 요청 세대 번호도 검사해 취소 이후 도착하는 이전 답변을 차단합니다. 답변은 패널 DOM·메모리에만 유지합니다. 브라우저 연결 종료 시 서버도 공급자 요청을 취소하지만, 이미 전송된 요청의 공급자 처리나 비용까지 되돌릴 수는 없습니다.

공급자 측 보관 정책은 Easynews의 로컬 저장 금지와 별개입니다. `store: false`만으로 공급자 전체의 Zero Data Retention을 보장하지 않습니다. [공식 데이터 정책](https://developers.openai.com/api/docs/guides/your-data)을 기준으로 계정 설정을 확인합니다.

## Phase 3 — Article Context

Readability는 clone DOM에서만 실행합니다. metadata와 공통 article 문단으로 보완하며 추출 전문·HTML은 로컬 함수 실행 후 유지하지 않습니다. ArticleContext의 textContent는 최대 1,200자 도입부이며 주변 문맥은 최대 1,600자입니다. session state에는 이 제한된 정보만 두고 기존 페이지·탭·패널 수명 정책을 적용합니다. 문맥 부족은 낮은 confidence로 표시하고 선택 문장 설명을 계속 허용합니다.

## Phase 4 — Related News

관련 뉴스 버튼에서 `POST /api/related`를 명시 호출합니다. 제목·URL/canonical·출처·시각·최대 1,200자 도입부만 받으며 선택 문장·전문·history를 받지 않습니다. Event Fingerprint → 최대 3회 NAVER 검색 → HTML/metadata 정규화 → URL/제목 중복·현재 기사 제외 → 상수 기반 점수 → 상위 12개 → 관계 판정 → 시간 검증 → 출처 제한 → 두 그룹의 순서입니다.

OpenAI 설정이 있으면 strict JSON schema와 runtime validation으로 fingerprint·후속/배경/related/irrelevant를 판정합니다. 설정이 없거나 실패하면 보수적 fallback과 안내를 제공합니다. 과거·같은 시각·unknown을 후속으로 표시하지 않고, 날짜만 있는 값도 시각 미확인으로 처리합니다. 그룹별 최대 4개·출처당 최대 2개이며 빈 그룹을 억지로 채우지 않습니다. 결과는 제목·출처 hostname·원문 링크·시각·최대 180자 관계 이유뿐입니다. 검색 description은 후보 판정에만 쓰고 반환하지 않습니다.

검색 provider는 서버 환경변수로만 인증합니다. 외부 기사 원문을 서버에서 다시 가져오지 않으며 캐시·DB·파일·읽기 이력은 없습니다. 요청 종료 후 fingerprint·후보·판정을 보관하지 않습니다. 결과는 패널 메모리·DOM에만 두고 기사·탭 이동·패널 종료 시 취소·제거합니다. 설명 오류와 관련 검색 오류 상태는 독립적입니다.

향후 캐시가 필요해도 최소 메타데이터와 짧은 TTL만 사용하고 원문 본문은 보관하지 않습니다. 설명·탐색 결과를 장기 저장하거나 사용자 학습 이력으로 축적하지 않습니다.

## 공식 API 근거

- [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel): 사용자 제스처에서 패널 열기
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): 사용자 실행 시 임시 탭 접근
- [Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage): 세션 메모리와 서비스 워커
- [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create): 요청·출력·저장 제어
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini): 기본 모델의 Responses 지원
- [Mozilla Readability](https://github.com/mozilla/readability): clone DOM과 추출 결과
- [NAVER 뉴스 검색](https://developers.naver.com/docs/serviceapi/search/news/news.md): JSON endpoint·인증·검색 metadata
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses text.format의 strict JSON schema
