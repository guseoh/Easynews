# Sign in with ChatGPT 전환 QA

기준일: 2026-10-03. 실제 Plus의 **핵심 E2E QA 성공**. 설치 확장의 화면·OAuth 승인은 사용자 수동 QA와 제공한 화면으로 확인했고, 에이전트는 서버 상태·실제 inference·Disconnect 후 요청 차단·재로그인·서버 재시작을 검증했다. Phase 4 실제 관계 판정은 NAVER API 미설정으로 미검증이다. mock 검증과 실제 plan 검증은 구분한다.

## 시작 상태와 호출 경계

- 시작 branch `main`, HEAD `14e9aa8`, clean, `origin/main`보다 2개 커밋 앞섬.
- Phase 1 `69d15a9`, Phase 2 `9f1be59`, Phase 3 `dcd525d`, Phase 4 `14e9aa8` 보존.
- 기존 설명: 패널 `requestExplanation` → `POST /api/explain` → validator → `server/src/openai.ts`. Payload는 `model`, `instructions`, 문자열 `input`, `store:false`, `max_output_tokens:1200`.
- 기존 Phase 4: `server/src/related-llm.ts`가 사건 fingerprint와 관계 판정에 OpenAI를 사용. Payload는 `model`, `instructions`, 문자열 `input`, `store:false`, `max_output_tokens:2500`, strict JSON schema `text.format`.
- 시작 README·`.env.example`은 API Key 기준. LICENSE와 package license 필드 없음. 자체 코드 MIT와 타사 notice를 먼저 추가.

## 공식 근거와 통합 결정

- [SIWC quickstart](https://developers.openai.com/siwc/quickstart)
- [로컬 앱 plan 사용](https://developers.openai.com/siwc/token-sharing-open-source)
- [등록·로그인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [계정·refresh·revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [모델·inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [preview 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [오류 처리](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [공식 UI 지침](https://developers.openai.com/siwc/ui-ux-guidelines)
- [DevKit 통합 cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [고정 DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit/tree/f723814abdccec135b519c451fb6e1992ee5e933)
- [DevKit 보호 저장소 계약](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/f723814abdccec135b519c451fb6e1992ee5e933/docs/security.md)
- [Windows DPAPI](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection)

공식 `@siwc/local` 0.1.0은 private local workspace이므로 npm의 동명 패키지를 임의 설치하지 않았다. 공식 소스를 고정 버전으로 `vendor/siwc-local`에 보존하고 서버 workspace dependency로 사용한다. 소스·upstream 테스트는 수정하지 않았고 build/test script 및 tsconfig 경로 변경만 원래 Noncommercial License로 표시했다. LICENSE·upstream THIRD_PARTY_NOTICES·provenance가 SDK build에 포함된다. OpenAI 로고·폰트·React 구성요소는 포함하지 않는다.

SDK는 OIDC discovery로 공식 인증 endpoint를 확인한다. 새 등록의 `dynamic_agent_client`와 callback의 issued client ID를 구분하고, state·nonce·PKCE·loopback Host/path·ID token 서명/issuer/audience/expiry/sub·반환 scope를 검증한다. `sendHostId:true`, `redirectPort:0`으로 IPv4 loopback listener를 먼저 열고 매번 fresh authorization을 시작한다. 기존 등록은 issued client ID를 재사용한다. scope는 공식 identity 및 `offline_access resource.invoke chatgpt.tokens.use.direct`이며 대화 내역 권한을 요청하지 않는다.

## 저장 및 요청 보안

Windows DPAPI `CurrentUser` 공급자가 SDK의 `CredentialEncryption` contract를 구현한다. PowerShell은 고정 코드만 인수로 받고 credential 데이터는 비공개 stdin/stdout pipe로 전달하며 숨김 실행한다. 별도 암호화 키·평문 fallback·credential 환경변수 전달은 없다. 보호 기능 실패 시 SDK는 로그인/요청을 차단하고 기존 파일을 보존한다.

`~/.config/easynews/chatgpt-auth.json`에는 credential·ID token·계정/등록 정보가 암호화된 envelope로만 저장된다. SDK의 interprocess lock과 원자적 교체를 사용하며 rotation과 pending identity checkpoint도 보호한다. `chatgpt-host.json`의 `urn:uuid:<UUIDv4>`는 별도 비밀이 아닌 호스트 식별자다. 같은 Windows 계정에서 재시작하면 credential과 등록을 재사용한다. 다른 OS는 지원하지 않으며 Windows 계정/profile을 잃으면 복호화할 수 없다. 같은 사용자 권한으로 실행되는 악성 코드에 대한 보호를 의미하지 않는다.

브라우저에는 토큰·인증 URL을 보내지 않는다. `/api/ai/*`는 기존 Host/Origin/확장 ID 검사와 no-store를 적용하며 고정된 UI 상태/계정 표시만 반환한다. 첫 연결 안내 boolean만 `chrome.storage.local`에 두며 뉴스·응답·읽기 이력은 저장하지 않는다. 공급자 오류 본문과 arbitrary 메시지도 패널에 전달하거나 로그로 남기지 않는다.

계정별 모델은 `GET https://api.openai.com/v1/models`로 조회한다. 정책 함수는 카탈로그의 Luna → mini → Sol → 나머지 텍스트 후보 순서로 선택한다. 정확한 slug는 서버가 반환한 목록에서만 사용하며 연결 변경 때 메모리 캐시를 폐기한다. 모델이 없으면 명확한 오류를 반환한다.

plan inference는 SDK의 `POST https://api.openai.com/v1/responses`만 사용한다. HTTP body는 `{model,input:[{role:'user',content}],instructions,store:false,stream:true}`이며 unsupported fields와 system role, 이전 응답·conversation은 없다. SDK는 delta를 누적하고 `response.completed`까지 기다린다. failed/incomplete/transport interruption은 부분 성공으로 반환하지 않는다. Easynews는 응답 길이를 추가 제한하며 패널 계약은 기존 JSON이다.

Phase 2의 세 prompt와 최소 입력을 유지했다. Phase 4의 검색·dedup·rank·시간·출처 검증은 유지하고 fingerprint/classification만 Provider로 연결한다. DevKit이 strict JSON schema 옵션을 노출하지 않아 plan 경로는 schema 지시문과 기존 runtime validation으로 검증한다. malformed 판정과 일반 AI 연결 실패는 보수적 규칙 fallback을 사용하며 인증·권한·사용 한도·보호 저장소 오류는 직접 안내한다. 한도 오류 후 새 plan 요청을 차단하며 API Key로 자동 전환하지 않는다.

Disconnect는 진행 중 요청을 중단하고 SDK의 공식 revocation을 시도한다. remote 실패에도 로컬 토큰을 제거하고 미확인 안내를 제공한다. 로컬 저장소 실패 때도 새 호출을 차단하며 원격/로컬 정리가 완료됐다고 허위 표시하지 않는다. 저장된 등록·host ID는 재로그인을 위해 유지한다.

## 자동 검증

- `npm run typecheck`: extension·SDK·server 통과.
- `npm run build`: extension·SDK·server 통과, 배포물 license/notice 보존.
- `npm test`: 2026-10-03 실제 QA 중 재실행한 runner 기준 전체 113개, 112개 통과, Unix 전용 SDK permission/symlink 테스트 1개 Windows에서 skip. extension 23/23, server 44/44, SDK 45/46 통과 + 1 skip. 이전 109개 표기는 반복문으로 생성되는 SDK 테스트 4개를 누락해 정정했다.
- 최종 UI 연결 상태 처리 보완 후 extension/server typecheck·build, `node --test server/tests/chatgpt-plan.test.mjs` 9개 통과.
- API Key migration default/명시 provider 선택/자동 billing fallback 금지.
- mock OAuth: fresh state/nonce/PKCE, 잘못된 callback Host/path/state, issued client ID 교체 거부, nonce 불일치, scope 누락.
- SDK upstream tests: signed identity mismatch, issuer/audience/expiry/signature, refresh rotation/checkpoint/JWKS 장애 복구, 암호화 공급자 실패, 파일 보존, disconnect 및 secret redaction.
- 동시 refresh 직렬화, 실제 Windows DPAPI 합성 credential의 별도 프로세스 복호화와 ciphertext 훼손 거부.
- 모델 선택/모델 없음, 세 설명 모드·Phase 4 최소 payload와 runtime validation.
- SSE store=false/stream=true/지원 field만 포함, delta 누적/completed, failed/incomplete/malformed/중단.
- 사용 한도·인증 오류 구분, 추가 요청 중지, 연결 해제 중 늦은 sign-in 성공 폐기.
- `/api/ai/*` client/Origin/preflight 검사, 요청 body의 임의 credential 필드 거부.

## Chrome 합성 UI QA

`node extension/scripts/ui-qa.mjs`의 `/chatgpt-qa`는 실제 built panel을 사용하지만 Chrome API·OAuth 상태·AI 응답은 합성이다. 실제 인증 endpoint나 사용자 credential을 사용하지 않는다.

연결 전 AI 버튼 비활성화, Continue with ChatGPT, 첫 연결 welcome, Using ChatGPT plan/합성 계정 표시, 설명 응답·최소 요청 필드, 한도 안내 및 버튼 중지, Disconnect 후 답변 정리를 확인했다. 실제 browser OAuth consent·설치 extension 연결은 아래 별도 QA로 남긴다.

## 실제 Plus QA — 핵심 흐름 통과

시작 상태: `main`, HEAD `4d0cda7`, clean, `origin/main`보다 5개 커밋 앞섬. Git에서 제외된 로컬 `server/.env`만 `AI_PROVIDER=chatgpt-plan`과 설치 확장 ID로 설정했다. 기본값과 API Key Provider는 변경하지 않았다.

| 항목 | 실제 확인 결과 |
| --- | --- |
| 설치 확장 새로고침·기사 Side Panel·Plus OAuth 로그인 | 사용자가 완료 확인. Windows Computer Use가 Chrome URL 판별 실패로 중단되어 에이전트가 화면을 직접 조작하거나 로그인 승인을 수행하지 않았다. |
| 서버 연결·plan 승인·모델 discovery | `/health` 정상, `/api/ai/status` HTTP 200, `chatgpt-plan`·`connected`·`sharing=true`·`gpt-5.6-luna` 확인. 계정 표시 정보는 기록하지 않았다. |
| 쉽게 설명 / 왜 그런가 / 배경 설명 서버 inference | 최소 합성 예문으로 실제 plan 호출. 세 모드 모두 HTTP 200, 비어 있지 않은 한국어 응답, 8,000자 이내 확인. 기사 전문·사용자 선택·응답 내용은 기록하지 않았다. |
| Responses 완료 | 서버가 사용하는 공식 SDK는 `response.completed`를 받아야 성공 반환한다. 위 세 HTTP 200은 이 경로를 통과한 결과이며 별도 SSE 내용 로그는 만들지 않았다. |
| 보호 저장소 재사용 | 별도 Node 프로세스의 동일 SDK·Windows DPAPI 공급자로 실제 보호 저장소에서 `connected`·`sharing=true` 재확인. 서버 재시작 후에도 HTTP 200, `connected`·`sharing=true`·동일 모델 조회 성공을 7,924ms에 확인했다. |
| 설치 확장의 세 응답·선택 변경·Manage usage | 사용자가 기능 정상 작동을 확인했고 실제 네이버 기사에서의 설명 응답·연결 상태 화면 5개를 제공했다. 화면에서 응답 내용이나 계정 정보를 추출해 문서·로그에 복사하지 않았다. 화면에 직접 나타나지 않는 선택 변경·Manage usage는 사용자 수동 확인을 근거로 기록한다. |
| Disconnect·후속 요청 차단 | 사용자의 연결 해제 후 서버 상태 `disconnected`·`sharing=false`, 오류 없음 확인. 후속 AI 요청은 HTTP 401 / `CHATGPT_SIGN_IN_REQUIRED`, 답변 없음. 별도 프로세스의 SDK에서도 `disconnected`·`sharing=false` 확인. |
| 재로그인 | 사용자가 OAuth 재로그인 완료 확인. 서버에서 HTTP 200, `connected`·`sharing=true`·동일 모델 조회 복구, 실제 설명 재호출 HTTP 200과 유효 응답 확인. |
| Phase 4 실제 관계 판정 | NAVER 검색 API 미설정으로 미검증. |

초기 서버 재시작 직후 15초 제한의 상태 probe가 한 번 시간 초과됐다. 원인은 특정하지 않았으며 제품 코드 수정 근거로 삼지 않았다. 재로그인 후 서버를 다시 시작해 40초 제한으로 동일 경로를 검증했고 7,924ms에 성공했다. 화면 기능 오류는 사용자가 보고하지 않았고, 재로그인과 재시작 재검증에서도 오류가 없었다.

새 기능·인증 구조·credential storage 정책·API Key Provider를 변경하지 않았다. 문서의 QA 상태와 테스트 집계만 수정했다. 스크린샷은 사용자가 제공한 원본 위치에 두고 저장소에 복사하지 않았다. 서버는 로컬 opt-in plan 모드로 실행 중이며 구현 기본값은 API Key다.

남은 미검증: 실제 NAVER 검색 및 Phase 4 관계 판정, Pro 계정, 실제 사용 한도 도달·계정 비적격·OS 보호 저장소 손상 같은 오류 경로. 이 경로들의 mock/합성 테스트 성공을 실제 검증으로 표시하지 않는다.

### 실제 QA 체크리스트

준비: Windows, build한 설치 extension, 로컬 서버 `.env`의 `AI_PROVIDER=chatgpt-plan` 및 확장 ID. 관련 뉴스에는 NAVER 검색 설정이 필요하다. API Key는 이 경로에서 필요하지 않다. 키·OAuth 코드·token·인증 URL을 QA 기록에 넣지 않는다.

1. Side Panel에서 Continue with ChatGPT 클릭.
2. 시스템 브라우저에 공식 OpenAI OAuth가 열리는지 확인.
3. Plus/Pro 계정 선택.
4. plan usage consent를 사용자가 직접 검토·승인.
5. `127.0.0.1` loopback callback 후 Easynews 복귀.
6. Connected/Using ChatGPT plan·계정 표시 및 첫 welcome 확인.
7. 실제 계정 모델 discovery 성공 확인; 토큰을 출력하지 않음.
8. 네이버 등 실제 기사에서 짧은 문장 선택.
9. 쉽게 설명 실제 응답.
10. 왜 그런가 실제 응답.
11. 배경 설명 실제 응답.
12. Phase 4 fingerprint·관계 판정·원문 링크 확인.
13. Manage usage가 공식 `https://chatgpt.com/settings/usage`를 여는지 확인.
14. Disconnect, 기존 응답 정리·후속 호출 차단·원격 해제 결과 확인.
15. 저장된 연결로 다시 로그인; 같은 host/client 등록 재사용 확인.
16. 서버 재시작 후 같은 Windows 계정의 보호 저장소 재사용, 복호화 불가 시 차단 확인.

기본값 전환은 이번 작업 범위가 아니다. 핵심 Plus E2E 성공에 따라 다음 변경에서 `chatgpt-plan`을 기본 Provider로 바꿀지 별도 제안만 한다. `.env.example`과 Provider 선택 기본값은 API Key로 유지하며 API Key Provider도 보존한다. API Key 실제 inference와 실제 NAVER 검색의 이전 미검증 상태도 별도로 유지한다.
