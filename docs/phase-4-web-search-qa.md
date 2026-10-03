# Phase 4 — ChatGPT web search 전환 QA

검증일: 2026-10-03. `main`의 `3f671aa`에서 시작한 별도 변경. 실제 Plus의 검색·메타데이터 보강·관계 판정 transport는 세 분야 모두 성공했다. 추천 품질은 부분 검증이다. 국제 후속 4개를 확인했지만 경제·IT와 배경 그룹은 빈 결과이며, 이를 추천 품질 전체 성공으로 표시하지 않는다.

## 구현과 요청 계약

`OpenAIWebSearchProvider.search(query, signal)`로 기존 SearchNews interface를 유지한다. 실제 서버는 제목·핵심 사건·주체·키워드·최대 3개 검색어를 한 요청에 묶어 후보를 모은다. NAVER 어댑터는 이전 mock fixture용으로 보존하고 서버에서 사용하지 않는다. 별도 OpenAI/NAVER 키·검색 API를 요구하지 않는다. 명시적인 API Key 문장 설명 Provider와 Windows DPAPI credential 정책은 유지한다.

검색과 관계 판정은 별도 요청이다. 검색·fingerprint·관계 판정은 GPT-6 Luna · Medium이고 기존 Phase 2는 Extra High·30초로 유지한다.

```json
{"model":"gpt-6-luna","reasoning":{"effort":"medium"},"tools":[{"type":"web_search","search_context_size":"low"}],"tool_choice":"required","store":false,"stream":true,"include":["web_search_call.results","web_search_call.action.sources"]}
```

return_token_budget은 생략해 기본값을 유지한다. SDK는 기존 stream 오류 검증과 response.completed 요구를 유지하며 optional onEvent에서 구조화된 search item만 수집한다. results/sources의 title·url·domain만 NewsCandidate에 매핑하고 URL-only source는 제목을 만들지 않는다. AI 답변·검색 snippet으로 후보나 날짜를 파싱하지 않는다. 실험에서 completed의 output이 비어도 output_item.done의 검색 item으로 정상 처리했다.

현재 URL/canonical·exact/near title 중복 제거 → 기존 deterministic ranking → 최대 12개 metadata 확인 → 보강 제목 재중복/재순위 → temporal 제약 → GPT 관계 판정 → 최종 시간 강제 검증 → 그룹 4개·출처당 2개 제한이다. 후보 본문은 AI에 보내지 않는다.

## 메타데이터와 데이터 경계

일반 Article JSON-LD datePublished → article:published_time → publication date meta → time[datetime] 순서다. dateModified·일반 본문 날짜는 사용하지 않는다. 명시적인 시간·시간대 없는 날짜와 invalid 값은 unknown으로 남긴다. 확인되지 않은 날짜와 현재보다 과거/같은 시각은 follow_up으로 확정하지 않는다.

최대 12개 페이지만 동시 3개·각 5초·512 KiB로 공개 HTTP(S) 페이지를 일시 확인한다. DNS의 모든 주소를 검증하고 소켓 주소를 고정하며 리다이렉트마다 다시 검사한다. 사설/루프백/예약 IP·credential URL·비표준 포트는 차단한다. 쿠키·Authorization 없이 요청하며 기사 본문 추출·로그·캐시·DB·history를 만들지 않는다. 페이지 실패는 후보의 날짜 미확인으로 처리한다.

검색 90초, 전체 관련 endpoint 120초, fingerprint/classification 각 45초, 패널 135초. 전체 상한이 우선한다. opt-in NDJSON으로 searching → checking → classifying와 최종 result/error를 전송하고 JSON 응답도 보존한다. 취소·기사 이동 시 늦은 진행 상태와 결과를 버린다.

## 실제 Plus QA 범위

실제 보호된 Easynews SDK 연결을 사용했다. 빌드한 확장의 requestRelated client → 실제 루프백 HTTP createApp → 생산용 provider/related/enrichment → 실제 OpenAI Responses 및 공개 뉴스 페이지를 통과했다. API 응답은 모킹하지 않았다. 계측용 임시 포트로 URL만 바꾸고 Chrome runtime ID를 제공했다. 현재 기사 입력은 실제 페이지 title·publication·짧은 meta description이며 경제 입력의 짧은 description은 제목과 함께 전달했다. 본문·selected text·전체 AI 답변은 QA 기록에 남기지 않았다.

**설치된 Chrome Side Panel 자체는 이번 변경에서 수동/화면 재검증하지 않았다.** 이전 SIWC 수동 QA와 이번 실제 HTTP/plan QA를 구분한다.

| 분야 | 검색 | 전체 | tool 호출 | 수집 후보 | 보강 후보/날짜 확인 | 최종 판정 후보 | 후속/배경 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 경제·부동산 | 20.84s | 55.72s | 2 | 33 | 11/7 | 9 | 0/0 |
| 국제 | 22.82s | 59.67s | 2 | 29 | 12/12 | 12 | 4/0 |
| IT·AI | 19.13s | 58.32s | 2 | 32 | 12/2 | 11 | 0/0 |

검색 평균 **20.93s**, 범위 **19.13–22.82s**. 전체 평균 **57.91s**, 범위 **55.72–59.67s**. 실행당 fingerprint·search·classification 3개 요청, 총 9개 모두 response.completed를 수신했다. 검색은 각각 web_search_call 2회 완료했다.

수신한 검색 이벤트: response.created / response.in_progress / response.output_item.added / response.web_search_call.in_progress / response.web_search_call.searching / response.web_search_call.completed / response.output_item.done / response.output_text.annotation.added / response.output_text.delta / response.output_text.done / response.content_part.* / response.completed. answer text는 후보 데이터로 사용하지 않았다.

입력 기사:

- 경제·부동산: [“여행·취미 다 포기”…소득 절반 대출 갚아야 서울 국평 아파트 마련](https://www.mk.co.kr/news/economy/12167726) · 2026-10-03T00:57:55.000Z
- 국제: [[종합] 트럼프, 韓 540억달러 알래스카 LNG 투자 발표 예고](https://www.newspim.com/news/view/20260930000185) · 2026-09-29T23:51:00.000Z
- IT·AI: [AI로 무게중심 옮기는 오라클…클라우드 인프라 매출 121%↑](https://zdnet.co.kr/view/?no=20260911113552) · 2026-09-11T02:38:53.000Z

국제 최종 후속 기사(제목·발행 시각·원문 URL만 기록):

- ["韓 2000억달러 대미투자에 알래스카 LNG 포함"…트럼프 540억달러 발표](https://www.fnnews.com/news/202610010237067824) · 파이낸셜뉴스 · 2026-09-30T17:46:27.000Z
- [트럼프, 韓 '알래스카 LNG 투자' 굳히기 나서…업계는 "사업성 의문"](https://web3.newspim.com/news/view/20261001000108) · 뉴스핌 · 2026-09-30T23:54:00.000Z
- [美개발사 사업 승인도 안했는데…트럼프 "韓, 알래스카 LNG 투자"](https://www.fnnews.com/news/202610011323559992) · 파이낸셜뉴스 · 2026-10-01T04:24:28.000Z
- [美 "알래스카 LNG 투자 결정" vs 韓 "검토 단계"…500억달러 사업 '온도차'](https://ir.newspim.com/news/view/20261001000339) · 뉴스핌 · 2026-10-01T01:19:00.000Z

국제 입력의 발표 예고 이후 실제 발표·한국 정부의 검토 입장·사업 승인 논쟁으로 진행한 제목들을 반환했다. 네 항목 모두 현재 입력 이후 날짜이며 메타데이터 요청에서 공개 뉴스 페이지를 확인했다. 파이낸셜뉴스 2개·뉴스핌 2개로 출처 상한을 지켰다. 제목과 최소 메타데이터 기준으로 후속 관계를 확인했고 후보 전문을 읽고 주장 전체를 대조한 검증은 아니다.

경제는 가격·부담 지표의 과거 보도와 일반 시세 페이지, IT는 같은 실적 재보도·일반 GPU 서비스·Telegram 등 넓은 후보가 남았다. 현재 기사와 가까운 재보도는 보강 후 다시 제거했다. 단순 관련 주제와 일반 정보는 최종 추천에서 제외됐다. 경제·IT 결과가 비어 있어 각 분야의 추천 recall과 배경 기사 유용성은 충분히 입증되지 않았다. 날짜 확인은 분야별 7/11·12/12·2/12로 편차가 크다. portal/접근 제한/비표준 metadata는 unknown으로 남으며 날짜를 추측하지 않는다.

초기 QA에서 긴 keyword/entity 구절 때문에 경제 후보가 모두 ranking에서 빠졌다. 고유명사와 짧은 독립 키워드를 요구하도록 fingerprint 지시문을 보완했다. 또한 실제 IT 결과에 note.com 블로그가 들어온 것을 확인해 명백한 블로그·동영상 URL을 deterministic filter에서 제외했다. 한국 언론사 whitelist나 hosted blocked_domains 설정은 추가하지 않았다. 보완 후 세 분야를 다시 실행했고 최종 추천에 YouTube/blog/PDF·동영상·일반 정보는 없었다. 새로운 noise 도메인의 완전 차단은 보장하지 않는다.

plan 상태는 시작·종료 모두 connected·sharing:true였으며 usageLimited:false이고 인증·한도 오류가 없었다. 별도 API key 경로를 호출하지 않았다. Manage usage 화면의 잔여량/과금 집계 자체는 이번 작업에서 확인하지 않았다.

## 자동 검증과 회귀

- `npm run build`: 성공(확장·SDK·서버).
- `npm run typecheck`: 성공(세 workspace).
- `npm test`: 128개 중 127개 성공, Windows에서 Unix 전용 SDK 1개 skip, 실패 0.
- 신규 검증: hosted request 계약·event metadata·empty completed output·미완료/failed/incomplete/tool 미실행·timeout/취소·사용 한도·candidate URL/noise mapping·기존 URL/title dedup·상한·보강 이후 재중복/시간 검증·NDJSON deadline·JSON 호환.
- metadata 검증: Article JSON-LD 우선순위·일반 meta·time·missing/invalid/timezone-free date·fetch 실패·동시 3개·취소·SSRF/리다이렉트/DNS pinning.
- Phase 1~3와 세 설명 모드·API Key Provider·DPAPI·OAuth SDK 회귀 테스트 성공. 모든 자동 외부 호출은 mock이다.
- 최종 빌드로 재시작한 실제 서버의 Phase 2 회귀: 세 모드 모두 HTTP 200·유효한 응답, simple 16.23s / why 8.46s / background 7.72s. 합성 짧은 문장으로 검증하고 답변은 출력·기록하지 않았다.

## 남은 제한

- 설치 Chrome 재로드 후 진행 표시·원문 링크·기사 이동·패널 종료 화면 QA.
- 새 분야/검색 반복 시 후보 변동, 일반 정보 페이지 유입, 엄격한 제목·날짜·관계 필터에 따른 빈 결과.
- 배경 그룹의 유용한 실제 비어 있지 않은 결과는 최종 QA에서 입증하지 못했다.
- 전체 약 58초는 빠른 상호작용에는 길다. stage 표시와 취소·상한은 작동하지만 latency 최적화는 추가 검증이 필요하다.
- Pro·실제 한도 소진/보호 저장소 손상·원격 인증 장애는 미검증이다.

공식 근거: [Web search 설정과 sources](https://developers.openai.com/api/docs/guides/tools-web-search), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [ChatGPT plan inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
