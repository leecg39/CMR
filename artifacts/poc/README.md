# 실제 PoC 증거

검증일: 2026-10-01, 로컬 합성 데이터. 실제 문자 발송은 하지 않았다.

| 증거 | 내용 |
|---|---|
| [최종 전달 요약](delivery-summary.json) | 현재 소스·SDK 지문, 검사 수, 서버 상태와 사용자 요청으로 미룬 범위 |
| [출시 준비 상태](release-readiness.json) | 최신 브라우저 검증 완료, 실연동·파일럿 연기, 실제 출시 보류 |
| [HTTP·DB 결과](http-only/http.json) | 기본 실행 시점 소스 지문, 고객사 격리·원장·롤백·재시작 10개 검사, 임시 DB·역할 정리 |
| [API 로그](http-only/api.log) | 별도 API 프로세스의 실제 HTTP 검사 |
| [합성 증빙](http-only/synthetic-evidence.json) | 원장 이벤트와 게시 문구의 원본 |
| [스캐너 결과](scanner.json) | Linux/Docker에서 격리·sandbox·프록시·인증 7개 검사 |
| [복구 PoC](recovery/http.json) | 기본 10개와 전체 암호화 백업·복원·삭제 이력 보존 3개, 총 13개 |
| [복구 전후 테이블 지문](recovery/backup-table-fingerprints.json) | public 테이블 33개의 행 수·지문 일치 |
| [수정 전 삭제 이력 누락](recovery-repro/http.json) | 실제 복원 후 삭제 이력 재내보내기가 빈 목록이 된 재현 |
| [자동 테스트 로그](../poc-tests-2026-10-01.log) | PostgreSQL 및 HTTP 회귀 테스트 62개 |
| [빌드 로그](../poc-build-2026-10-01.log) | TypeScript 검사와 프로덕션 빌드 |
| [수정 전 웹 회귀 실패](web-retry-before-fix.log) | 같은 선택 재전송이 409로 실패한 재현 |
| [의존성 감사](latest/npm-audit.json) | 검사 시점 운영 의존성의 알려진 취약점 0개 |
| [초기 브라우저 결과](latest/browser.json) | 초기 SDK 선택·재방문 9개 시나리오. 최신 수정의 증거로 사용하지 않음 |
| [초기 브라우저 서버 원본](latest/browser-server-records.json) | 수정 전 마지막 상태 DENIED. 현재 구현은 허용 철회를 REVOKED로 구분 |
| [최신 브라우저 검증](web/browser.json) | 최신 SDK의 기본·연속 선택·API 장애와 복구 16개 통과 |
| [최신 브라우저 서버 원본](web/browser-server-records.json) | 이벤트 14건과 마지막 두 목적의 REVOKED 상태 |
| [수정 전 저장 장애 안내](final-web/network-failure-before-fix.json) | 연결 실패 시 영어 안내가 표시된 재현. 최신 검증에서는 한국어 안내 확인 |

최신 SDK의 연속 선택·철회와 API 장애 흐름은 승인된 새 Ego Lite 공간에서 검증했다. 임시 API·DB·역할과 스캐너 시험 컨테이너·Lima VM은 검증 뒤 종료했다. 재사용 명령은 [운영 안내](../../docs/OPERATIONS.md)에 있다.

전체 단계와 미완료 관문은 [PoC 안내](../../docs/POC.md), [제한 출시 관문](../../docs/LIMITED_RELEASE.md)을 참고한다. SOLAPI 실계정·승인된 번호·고객 사이트와 운영 환경의 결과가 준비되기 전에는 제한 출시를 승인하지 않는다.

사용자 요청에 따라 문자·080 실연동과 파일럿은 후속 작업으로 미뤘다. 이번 로컬 구현·PoC·웹 재검증은 완료했다.

복구 폴더의 암호화 덤프는 합성 시험 산출물이다. 시험 키는 메모리에서만 사용하고 실행 후 폐기하여 운영 복구용으로 사용할 수 없다. 서명 삭제 이력도 합성 주체의 시험 기록이다.
