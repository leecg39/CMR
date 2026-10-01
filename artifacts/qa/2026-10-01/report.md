# CMP QA 보고서

## 결과

중간 중요도 오류 1건을 수정하고 실제 브라우저 다운로드로 재검증했다. 중간 중요도 이상 미해결 오류는 없으며, 문구 개선 2건은 Standard 범위의 후속 항목으로 남겼다.

| 항목 | 결과 |
|---|---|
| 검증일 | 2026-10-01, Asia/Seoul |
| 대상 | http://127.0.0.1:4310/ |
| 기준 버전 → 최종 검사 버전 | acb1f75 → 7bb09b7 |
| 모드 | Standard, 합성 데이터·모의 공급자 |
| 브라우저 | Ego Lite 공간 12, 종료 확인 |
| 관리자 메뉴 | 7개, 데스크톱·390px 모바일 |
| 브라우저 흐름 검사 | 관리자 17개, 웹 CMP 16개 |
| 기록 | 화면 18개, 브라우저 관찰 약 13분 |

## 실행 결과

| 검사 | 결과 | 증거 |
|---|---|---|
| 자동 테스트 | 63개 통과, 실패·건너뜀 0개 | [최종 로그](tests-final.log) |
| TypeScript·프로덕션 빌드 | 통과 | [최종 로그](build-final.log) |
| 로그인·입력·회원 등록·검색·필터 | 정상 | [브라우저 원본](browser-checks.json) |
| 연락처·마케팅 이용·문자 동의·예약·철회 | 예약 취소, 다음 발송 CONSENT_WITHDRAWN/SUPPRESSED 차단 | [화면](screenshots/withdrawal-blocked.png), [합성 증빙](evidence.json) |
| JSON·CSV 내보내기 | JSON SHA-256 일치. 수정 후 CSV 3건의 두 시각 모두 JSON과 일치 | [대조](csv-after-fix.json), [CSV](evidence-after.csv) |
| 워크스페이스 전환 | 다른 고객사에서 QA 회원 검색 결과 0행 | [원본](browser-checks.json) |
| 모바일·모달 | 7개 메뉴 모두 폭 390px, 가로 넘침 0. 포커스 이동·Escape 닫기 정상 | [화면](screenshots/mobile-member.png), [모달](screenshots/mobile-modal.png) |
| 웹 CMP | 선택·재방문·연속 선택·저장/설정 API 장애와 복구 16개 통과 | [원본](web/browser.json) |
| HTTP·서버 기록 | 11개 통과. 웹 이벤트 14건, 마지막 분석·광고 모두 REVOKED | [HTTP](web/http.json), [원장](web/browser-server-records.json) |
| 로그아웃 | 로그인 화면 복귀, 보호 API 401 | [화면](screenshots/logout.png) |

예상하지 않은 브라우저 실행 오류는 0건이었다. 잘못된 로그인·입력·로그아웃 후 접근과 의도적으로 차단한 네트워크의 오류 응답은 예상된 거부 결과로 구분했다. 관리자 API와 워커는 실행 중이며, 이번 PoC의 임시 API·DB·역할과 QA 작업 공간은 정리했다.

## 발견과 수정

| 중요도 | 발견 | 현재 미해결 |
|---|---|---|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 1 | 0 |
| Low | 2 | 2 |

| 항목 | 상태 | 커밋 | 파일 |
|---|---|---|---|
| ISSUE-001 | verified | 99314d7 | [CSV 직렬화](../../../packages/evidence/index.ts) |
| 회귀 테스트 | 통과 | 7bb09b7 | [테스트](../../../tests/evidence-csv.regression-1.test.ts) |

수정 전 같은 테스트가 시각 불일치로 실패했고, 수정 후 UTC ISO 8601과 밀리초를 유지했다. Date 입력과 이미 직렬화된 문자열 입력을 함께 검증했다. [수정 전](csv-regression-before.log), [수정 후](csv-regression-after.log), [다운로드 재검증](csv-after-fix.json).

## ISSUE-001: 증빙 CSV에서 타임스탬프 밀리초 누락

- 중요도: medium
- 분류: functional
- 상태: verified, 수정·실제 다운로드 재검증 완료
- 영향: JSON 원본의 서버 수신 시각과 CSV를 다시 파싱한 시각이 다르다.
- 재현: 합성 회원의 동의 2건과 철회 1건을 기록 → 증빙·정책에서 같은 회원의 JSON·CSV 다운로드 → `received_at` 대조. CSV를 두 번 내려받아 같은 결과를 확인했다.
- 예: JSON `2026-10-01T03:36:10.703Z`, CSV 재파싱 `2026-10-01T03:36:10.000Z`.
- 원본 증거: [JSON](evidence.json), [CSV](evidence.csv), [재다운로드](evidence-before-repeat.csv), [대조 결과](csv-before-fix.json).
- 화면: [다운로드 전](screenshots/issue-001-before.png), [다운로드 후](screenshots/issue-001-exported-before.png).
- 예상: JSON과 같은 ISO 8601 UTC 시각과 밀리초를 유지한다.

### 수정 후 증거

[수정 후 화면](screenshots/issue-001-after.png) · [실제 CSV](evidence-after.csv) · [JSON 대조](csv-after-fix.json)

## ISSUE-002: 검색 결과 없음이 회원 미등록처럼 안내됨

- 중요도: low, 분류: content, 상태: deferred (Standard 범위의 문구 개선)
- 회원 21명이 있는 화면에서 없는 검색어를 입력하면 ‘등록된 항목이 없습니다.’라고 표시한다. 검색을 지웠다가 다시 입력해 재현했다.
- 예상: ‘검색 조건에 맞는 회원이 없습니다.’로 검색 결과와 실제 회원 수를 구분한다.
- 화면: [검색 전](screenshots/issue-002-step-1.png), [검색 결과](screenshots/issue-002-result.png).

## ISSUE-003: 통지 템플릿에 내부 코드 표시

- 중요도: low, 분류: content, 상태: deferred (Standard 범위의 문구 개선)
- 처리 결과 통지의 템플릿 칸에 processing_result가 표시된다. 다른 메뉴 방문 후 다시 확인해 재현했다.
- 예상: ‘처리 결과 통지’처럼 담당자가 이해할 수 있는 이름을 표시한다.
- 화면: [발송 작업](screenshots/issue-003.png).


## 품질 점수

검사한 범위의 관찰 기반 점수: **98.1 → 99.7/100**. 기능 Medium 1건 수정으로 +1.6, 콘텐츠 Low 2건은 남아 있다.

| 범주 | 가중치 | 수정 전 | 수정 후 |
|---|---|---|---|
| Console | 15% | 100 | 100 |
| Links | 10% | 100 | 100 |
| Visual | 10% | 100 | 100 |
| Functional | 20% | 92 | 100 |
| UX | 15% | 100 | 100 |
| Performance | 10% | 100 | 100 |
| Content | 5% | 94 | 94 |
| Accessibility | 15% | 100 | 100 |

점수는 이번 로컬 흐름에서 관찰한 결함을 기준으로 계산한다. 전체 접근성·성능 인증이나 운영 서비스 품질을 의미하지 않는다. 후속 개선은 검색 결과 안내와 처리 결과 통지 템플릿의 표시 이름이다.

## 범위와 후속

- 사용자 요청대로 SOLAPI 실문자·080 왕복과 실제 고객 파일럿은 제외했다. 운영 배포·실제 결제·고객 사이트의 모든 태그·관리자 MFA 등록은 이번 브라우저 QA에서 완료로 표시하지 않는다.
- 데이터는 합성이다. QA 회원 `qa-ui-20261001-702425` 1명은 동의·철회 증거를 보존하며 문자 수신 상태는 REVOKED, 예약은 취소 상태다. 실제 문자를 보내지 않았다.
- 실제 출시는 [출시 관문](../../../docs/LIMITED_RELEASE.md)의 후속 조건을 충족해야 한다.
- 비교용 [baseline.json](baseline.json), 요약 [summary.json](summary.json)을 저장했다.

**PR 요약:** QA에서 3건 발견, 1건 수정·검증, Low 2건 후속. 자동 테스트 63개·웹 CMP 16개 통과.
