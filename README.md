# Easynews

뉴스 원문을 직접 읽으면서 어려운 문장을 이해하고, 이어지는 기사와 배경 기사를 탐색하는 개인용 리딩 어시스턴트입니다. 경제뿐 아니라 정치·국제·사회·IT 등 일반 뉴스가 대상입니다.

**Easynews는 기사 원문을 저장·재배포하지 않고, 사용자가 현재 읽고 있는 기사에서 요청한 최소한의 텍스트만 일시적으로 처리합니다. 관련 뉴스는 제목·출처·링크 중심으로 제공하고 원문은 항상 언론사 페이지에서 읽도록 합니다.**

**Phase 1 — Extension Foundation**, **Phase 2 — AI Explanation**, **Phase 3 — Article Context**, **Phase 4 — Related News**를 구현했습니다. 공식 **Sign in with ChatGPT + ChatGPT plan** 경로는 실제 Plus의 핵심 E2E QA를 통과했습니다. 사용자 요청에 따라 기본 Provider는 ChatGPT plan이며 모델은 **GPT-6 Luna · Extra High**입니다. Pro 및 실제 NAVER 검색·관계 판정은 미검증입니다. 자동 검증·Chrome fixture와 실제 환경 QA를 구분합니다.

- Chrome Manifest V3 확장 및 Side Panel
- 확장 아이콘 실행 시 현재 페이지 제목·URL 확인
- 실행 전에 선택한 문장과 실행 후 새로 선택한 문장 표시
- 탭 전환·페이지 이동·패널 종료 시 임시 상태 제거
- 접근 제한 페이지 안내, 상태 다시 확인
- 로컬 서버의 `POST /api/explain`과 쉽게 설명 / 왜 그런가 / 배경 설명
- AI 요청 중 상태 표시, 오류 안내·재시도, 선택·페이지 변경 시 요청 취소 및 답변 제거
- 명시 요청으로 이어지는 기사·배경 기사 검색, 제목·출처·날짜·짧은 관계 이유·원문 링크 표시

복제 DOM에 Mozilla Readability를 적용하고 metadata와 공통 article 문단으로 보완합니다. 전문은 로컬 추출 중에만 사용하며, 세션에는 metadata·최대 1,200자 도입부·최대 1,600자 선택 주변 문맥만 둡니다. 비기사·낮은 신뢰도는 문맥 부족을 안내합니다. 기사 전체 분석·자동 요약은 구현하지 않습니다.

## 라이선스

Easynews 자체 소스 코드는 [MIT License](LICENSE)입니다. 타사 구성요소는 각자의 라이선스를 유지하며 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)를 참조하세요. 현재 프로젝트는 개인용·로컬·비상업 용도입니다. OpenAI Sign in with ChatGPT DevKit에는 별도의 Noncommercial License가 적용됩니다. 향후 상업 제품으로 전환할 때 SIWC 서비스 조건과 DevKit 라이선스를 다시 검토해야 합니다. Easynews의 MIT 라이선스가 OpenAI 구성요소·상표의 사용 권한을 대신하지 않습니다.

## 설치 및 실행

Node.js 22 이상, npm, Chrome 116 이상이 필요합니다.

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

테스트는 외부 API를 mocking하며 실제 API 키나 비용이 필요하지 않습니다. `npm test` 전에 `npm run build`로 서버 테스트의 대상 코드를 생성합니다.

1. Chrome에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 저장소의 `extension/dist` 폴더를 선택합니다. `extension` 폴더가 아닙니다.
5. 확장 목록에서 Easynews를 고정하고 일반 뉴스 페이지를 엽니다.
6. 이해하기 어려운 문장을 드래그한 뒤 Easynews 아이콘을 누릅니다.
7. Side Panel의 제목·URL·선택 문장을 확인합니다. 패널을 연 상태에서도 새 문장을 선택할 수 있습니다.

`Alt+Shift+E`로도 확장을 실행할 수 있습니다. 충돌하는 단축키는 `chrome://extensions/shortcuts`에서 변경합니다. 다른 탭으로 이동하거나 패널을 닫았다면 해당 탭에서 확장 아이콘을 다시 눌러 시작합니다.

코드를 변경한 뒤 `npm run build`를 실행하고 확장 관리 화면의 새로고침 버튼을 누릅니다. 기존 뉴스 탭도 새로고침한 뒤 확장 아이콘을 다시 눌러 주세요. 패널의 **다시 확인** 버튼은 화면 상태를 다시 읽습니다. 접근 권한 부여와 선택 감지 시작은 확장 아이콘으로 수행합니다.

## ChatGPT plan으로 AI 서버 실행

1. `server/.env.example`을 `server/.env`로 복사합니다.
2. 기본값 `AI_PROVIDER=chatgpt-plan`을 사용합니다. 이 경로는 `OPENAI_API_KEY`·API credit 설정을 요구하지 않습니다. 자격을 갖춘 Plus/Pro 계정과 plan 사용 승인이 필요합니다.
3. `chrome://extensions`의 Easynews 카드에 표시된 32자 ID를 `EASYNEWS_EXTENSION_ID`에 입력합니다.
4. Windows에서 같은 사용자 계정으로 실행합니다. 다른 OS의 보호 저장소는 이번 구현에서 지원하지 않습니다.
5. 저장소 루트에서 다음 명령을 실행합니다.

```powershell
npm run start:server
```

서버는 `http://127.0.0.1:3000`에서만 실행됩니다. 환경변수를 바꿨다면 서버를 재시작합니다. 빌드 후 확장 관리 화면에서 Easynews를 새로고침하고, 뉴스 페이지도 새로고침합니다.

Side Panel의 **Continue with ChatGPT**를 누르고 시스템 브라우저에서 계정과 plan 사용 승인을 완료합니다. **ChatGPT 연결됨 · Using ChatGPT plan** 표시 후 세 설명 모드와 관련 뉴스 AI 판정을 사용합니다. 모델은 `gpt-6-luna`, `reasoning.effort`는 `xhigh`(Extra High)로 명시합니다. 계정의 모델 discovery는 유지하지만 표시용 목록에 모델이 없다는 이유로 다른 모델로 전환하지 않습니다. 접근 권한은 실제 Responses 요청에서 확인하며 거부되면 오류를 안내합니다. 실제 Plus 호출에서 요청 모델·effort와 `response.completed`를 확인했습니다.

**Manage usage**는 공식 ChatGPT Settings → Usage로 연결됩니다. 플랜·앱 한도 오류는 일반 연결 실패와 구분하며 새 plan 요청을 멈춥니다. 한도를 확인한 뒤 **연결 다시 확인**을 누르면 명시적으로 재확인합니다. **Disconnect**는 진행 요청을 취소하고 원격 renewable session 해제를 시도한 뒤 로컬 토큰을 제거합니다. 원격 해제를 확인하지 못하면 패널에서 안내합니다. 연결 선택 메뉴에서 저장된 계정에 다시 로그인하거나 다른 계정을 추가할 수 있습니다.

### API Key migration/fallback

기존 API Key Provider는 `AI_PROVIDER=api-key`로 명시적으로 선택할 수 있습니다. 이 경로를 선택한 경우에만 `OPENAI_API_KEY`를 로컬 `.env`에 설정합니다. `OPENAI_MODEL` 기본값은 `gpt-4.1-mini`이며 Responses 지원·계정 접근 권한을 확인하세요. plan 요청 실패 시 API Key 과금으로 자동 전환하지 않습니다.

문장을 1~2,000자 선택한 뒤 **쉽게 설명 / 왜 그런가 / 배경 설명**을 누릅니다. 버튼을 누를 때 선택 문장·기사 제목(최대 300자)·필요한 주변 문맥(최대 1,600자)만 서버와 OpenAI에 전달합니다. 도입부·URL·전문은 설명 요청에 넣지 않습니다. 긴 선택을 자동으로 기사 전체 설명으로 바꾸지 않으며, 2,000자를 넘으면 설명 버튼을 비활성화합니다. 설명은 일반 텍스트로 표시하고, 오류가 나면 **설명 다시 시도**를 제공합니다. 자동 재시도는 하지 않습니다.

서버가 실행되지 않거나 선택한 Provider의 연결·설정 또는 확장 ID가 누락되면 안내를 표시합니다. 서버 상태 확인은 `GET /health`로 수행하며 키나 기사 데이터를 반환하지 않습니다. AI 연결 API에도 같은 확장 ID·Origin·Host 검사를 적용하고 토큰을 반환하지 않습니다. 이 검사는 임의 웹페이지의 호출을 줄이는 로컬 접근 제한이며 회원 인증 시스템은 아닙니다.

## 관련 뉴스 사용

서버의 `.env`에 `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`을 로컬에서 설정합니다. [NAVER 뉴스 검색 공식 문서](https://developers.naver.com/docs/serviceapi/search/news/news.md)에 따라 검색 API 사용 권한을 설정해야 합니다. 실제 키는 Git·확장·README에 넣지 않습니다.

기사에서 확장 아이콘을 누른 뒤 **관련 뉴스 찾기**를 누릅니다. 제목·URL/canonical·출처·발행 시각·최대 1,200자 도입부만 서버에 전달하고 선택 문장이나 전문은 보내지 않습니다. 검색은 최대 3회, 관계 판정 후보는 12개, 결과는 각 그룹 최대 4개·출처당 최대 2개입니다. 시각이 확인되지 않거나 과거인 기사는 후속으로 노출하지 않습니다. 결과가 부족하면 빈 그룹을 유지합니다.

연결한 AI Provider로 사건 특징·기사 관계를 판정합니다. API Key 경로는 strict JSON schema를 사용합니다. 공식 DevKit의 plan 인터페이스는 schema 옵션을 노출하지 않아 schema를 지시문에 넣고 동일한 runtime validation을 적용합니다. 일반 AI 호출 실패는 제목·시간 규칙의 보수적 결과와 안내로 처리합니다. plan 인증·권한·한도·보호 저장소 오류는 직접 안내하며 추가 AI 요청이나 자동 과금 전환을 하지 않습니다. 원문 링크는 새 탭으로 열립니다. 새 기사 탭에서 확장 아이콘을 눌러 접근을 부여한 뒤 다시 설명·탐색할 수 있습니다. 검색·읽기 이력이나 결과 캐시는 만들지 않습니다.

## 데이터 처리 경계

ChatGPT credential과 뉴스 임시 데이터는 분리합니다. 서버의 공식 SDK는 `~/.config/easynews/chatgpt-auth.json`에 Windows DPAPI `CurrentUser`로 암호화한 연결 정보를 원자적으로 저장하며 평문 fallback은 없습니다. 호스트 ID는 별도 `chatgpt-host.json`의 비밀이 아닌 UUID 식별자입니다. 같은 Windows 계정으로 서버를 재시작하면 보호된 연결을 재사용합니다. 보호 저장소가 없거나 복호화할 수 없으면 연결을 차단하고 기존 파일을 보존합니다. 토큰·인증 URL·뉴스 내용은 로그·확장 저장소로 보내지 않습니다. 패널에는 제한된 계정 표시 정보만 전달하고, 첫 연결 안내를 닫았다는 boolean만 `chrome.storage.local`에 저장합니다. ChatGPT 대화 내역에는 접근하지 않습니다.

Easynews는 기사 저장 서비스가 아닙니다. 기사 본문·사용자 정리·학습 기록을 장기 저장하지 않습니다. 사용자의 정리와 지식 축적은 별도의 Notion 또는 Obsidian에서 직접 수행하며, 해당 도구 연동도 MVP 범위 밖입니다.

Phase 1은 제목·URL·선택 문장만 `chrome.storage.session`의 임시 메모리에 둡니다. 파일·DB·브라우저 동기화 저장소·외부 서버에 기록하지 않습니다. 다른 탭·페이지로 이동하거나 패널을 닫으면 상태를 제거하고 선택 감지를 중지합니다. 확장을 다시 로드하거나 브라우저를 재시작해도 세션 상태는 지워집니다. 입력창과 편집 영역의 선택은 수집하지 않고, 긴 선택은 처음 8,000자까지만 표시합니다.

Phase 2의 답변은 열린 패널의 메모리·화면에만 존재하며 브라우저 저장소에 넣지 않습니다. 다른 문장 선택·탭/기사 이동·패널 종료 시 진행 중인 요청을 취소하고 답변을 제거합니다. 로컬 서버는 요청·답변·공급자 오류 본문을 로그·파일·DB·캐시에 기록하지 않고, 요청 수만 일시적으로 집계해 동시 요청을 최대 2개로 제한합니다. API 요청에는 `store: false`를 명시하고 대화 이력을 연결하지 않습니다.

`store: false`는 OpenAI 응답 저장을 비활성화하는 설정이며, 공급자 측의 모든 보관이 없다는 뜻은 아닙니다. OpenAI의 기본 악용 방지 로그에는 최대 30일 보관 정책이 적용될 수 있고 Zero Data Retention은 별도 계정 설정입니다. [OpenAI 공식 데이터 처리 문서](https://developers.openai.com/api/docs/guides/your-data)를 확인하세요. Easynews 자체의 저장 금지와 공급자의 데이터 정책을 구분합니다.

Phase 3/4도 이해·탐색에 필요한 최소 문맥·메타데이터만 일시 처리합니다. 기사 전문을 서버에 보내거나 원문 본문을 캐시에 보관하지 않습니다. 도입부는 관련 검색 요청에만 사용하고 요청 종료 후 서버가 보관하지 않습니다. 관련 결과는 패널 DOM·메모리에만 있으며 기사·탭 이동·패널 종료 시 취소·제거합니다. 관련 뉴스는 제목·출처·링크를 중심으로 날짜와 짧은 관계 이유를 표시하며, 기사 본문은 제공하지 않습니다. 원문 읽기는 언론사 페이지로 연결합니다.

캐시가 필요하면 최소 메타데이터와 짧은 유효기간을 적용하고 기사 저장이나 학습 기록 기능으로 확장하지 않습니다.

## 권한

| 권한 | 용도 |
| --- | --- |
| `activeTab` | 사용자가 확장 아이콘 또는 단축키를 실행한 현재 탭에 일시 접근 |
| `scripting` | 실행한 탭의 최상위 문서에 선택 감지 스크립트 주입 |
| `sidePanel` | 원문 옆에 패널 표시 |
| `storage` | 패널과 서비스 워커 사이의 임시 화면 상태 전달 |
| `http://127.0.0.1/*` | 로컬 설명·관련 뉴스 서버에 요청; 코드에서 주소·포트 3000 고정 |

`<all_urls>`, 뉴스 사이트 상시 접근 권한, 정적 `content_scripts`, `tabs` 권한은 사용하지 않습니다. 로컬 서버에만 `host_permissions`를 추가합니다. Chrome 호스트 권한은 포트를 좁히지 못하므로 실제 요청 주소는 코드에서 `127.0.0.1:3000`으로 고정합니다. `chrome://` 페이지, Chrome 웹 스토어 등 브라우저가 스크립트 주입을 금지한 페이지는 지원하지 않습니다. iframe 내부 선택과 PDF 뷰어도 지원 범위 밖입니다.

## 검증 상태

검증 결과는 [Phase 1 QA](docs/phase-1-qa.md), [Phase 2 QA](docs/phase-2-qa.md), [Phase 3 QA](docs/phase-3-qa.md), [Phase 4 QA](docs/phase-4-qa.md), [SIWC QA](docs/siwc-qa.md)를 참조하세요. 최신 전체 자동 테스트는 113개 중 112개 통과, Unix 전용 SDK 테스트 1개 건너뜀입니다. 실제 Plus의 핵심 E2E QA를 통과했습니다. 사용자가 설치 확장에서 OAuth·세 설명 모드·선택 변경·Manage usage를 수동 확인했고, 서버에서 plan 승인·모델 discovery·실제 Responses 완료·Disconnect 후 요청 차단·재로그인과 재시작 복구를 검증했습니다. 실제 NAVER 검색 및 Phase 4 관계 판정은 API 미설정으로 미검증입니다. 사용자 요청으로 기본 Provider를 ChatGPT plan으로 변경했습니다.

## 구조 및 다음 단계

`extension/src`는 서비스 워커·문맥 추출·선택 감지·패널 코드를, `extension/public`은 패널 HTML·CSS를 포함합니다. `server/src`는 Node.js HTTP 서버, 두 AI Provider, Windows 보호 저장소 어댑터, NAVER 검색 파이프라인을 포함합니다. `vendor/siwc-local`은 버전을 고정한 공식 DevKit이며 로컬 workspace dependency로 연결합니다. 빌드 결과는 Git에서 제외합니다. 확장 런타임 의존성은 Mozilla Readability이며 서버의 DevKit은 jose·proper-lockfile을 사용합니다.

Phase 1~4와 SIWC 구현·자동 검증·Chrome mock QA 및 실제 Plus 핵심 E2E를 마쳤습니다. 실제 NAVER 검색·Phase 4 관계 판정, Pro 계정과 실제 오류 조건의 QA가 남아 있습니다. 개인용 로컬 범위를 유지하며 노트·자동 요약·클라우드 인프라는 추가하지 않습니다.
