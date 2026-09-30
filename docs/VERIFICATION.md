# 검증 결과

검증일: 2026-09-30. 로컬 Node.js 22 / PostgreSQL 17 환경과 합성 데이터로 실행했습니다.

## 자동 검증

| 항목 | 결과 | 기록 |
|---|---|---|
| TypeScript 검사와 프로덕션 빌드 | 통과 | `artifacts/build.log` |
| 실제 PostgreSQL 기반 자동 테스트 | 38개 통과, 실패·건너뜀 0개 | `artifacts/tests.log` |
| 운영 의존성 감사 | 알려진 취약점 0개 | `artifacts/npm-audit.json` |
| 발송 판단 성능 | 100회, 동시 5건, p50 6.10ms / p95 12.42ms | `artifacts/performance.json` |

성능 수치는 로컬 합성 데이터 결과이며 운영 SLA가 아닙니다. 의존성 감사는 검사 시점의 알려진 취약점만 확인합니다.

테스트는 작업 데이터베이스와 분리한 임시 DB를 만들고 비소유자 역할로 실행했습니다. 테넌트 격리, 목적·채널 분리, 멱등성, 과거 이벤트, 철회와 예약 취소, 처리 실패, 시간 경계, 암호화, 서명과 재사용 차단, 삭제·복구·보유기간, MMS 승인 내용과 SOLAPI HTTP 계약을 포함합니다.

## Ego Lite 브라우저 검증

- 합성 회원의 발송 전 검사 허용 → 미래 예약 → 문자 광고 동의 철회 → 예약 취소와 다음 검사 차단을 실제 화면에서 확인했습니다.
- 웹 SDK 미선택 시 태그 요청 0건을 확인했습니다.
- 분석만 허용하면 분석 태그만 실행되고, 전체 허용하면 분석·광고 태그가 모두 실행됩니다.
- 전체 거절 후 재방문하면 두 태그 모두 실행되지 않습니다.
- SDK 결과는 `artifacts/browser-sdk.json`, 화면은 `artifacts/sdk-analytics-only.png`, `artifacts/withdrawal-blocked.png`에 저장했습니다.
- 모바일 390px에서 7개 메뉴를 이동해 가로 넘침이 없음을 확인했습니다. 측정값은 `artifacts/browser-mobile.json`, 화면은 `artifacts/dashboard-mobile.png`에 저장했습니다.
- 관리자 화면에서 합성 회원의 증빙 JSON을 내려받고 파싱을 확인했습니다. 결과는 `artifacts/evidence-sample.json`입니다.
- 최신 API와 워커를 실행했으며 `/v1/health`가 PostgreSQL 연결과 데모 모드를 반환했습니다.

## 실행하지 않은 검증

- SOLAPI 실계정·등록 발신번호·080 계약을 통한 실제 발송과 수신거부 왕복 검증
- Docker 런타임에서 격리 스캐너 컨테이너 빌드·실행 및 sandbox/egress 확인
- 실제 GTM 콘솔에 템플릿 가져오기와 고객 사이트별 태그 검사
- 결제 사업자 청구·정산 연동, 운영 인프라 배포와 백업 복원 훈련
- 고객별 문구·법적 근거·보유기간 검토와 파일럿 운영

현재 실행 환경은 모의 공급자를 사용합니다. 운영 출시 조건과 티켓별 대응은 [구현 범위](IMPLEMENTATION.md), 실행과 복구는 [운영 안내](OPERATIONS.md)를 참고하세요.
