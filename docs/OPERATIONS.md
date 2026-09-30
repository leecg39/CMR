# 실행·운영·복구

## 프로세스

- API: `npm run dev` — 127.0.0.1:4310
- 별도 워커: `npm run worker` — 5초마다 작업 조회
- 화면 개발: `npm run ui` — 127.0.0.1:5178, /v1을 API로 프록시
- 단일 실행: `이음 실행.command` — API와 워커 함께 시작, Control+C로 종료
- 빌드: `npm run build`

`.env`와 `.local/demo-access.json`은 0600 권한의 로컬 파일입니다. 실제 비밀값은 Git과 결과 보고서에 포함하지 않습니다. 운영에서는 비밀 관리 도구를 사용하고 데모 모드를 끕니다. 합성 데이터는 기존 운영 DB로 이관하지 않습니다.

## DB 설치와 변경

`npm run setup`은 로컬 관리자 소켓으로 새 DB와 비소유자 역할을 만들고 다음 파일을 순서대로 적용합니다.

1. `packages/database/schema.sql`
2. `0002_agreements.sql`
3. `0003_retention.sql`
4. `0004_templates.sql`

기존 DB의 마이그레이션은 소유자 계정으로 순서대로 적용합니다. 앱 역할에는 테이블 사용 권한과 `purge_retained_subject(uuid,uuid)` 실행 권한을 부여합니다. 앱 역할 자체에 슈퍼유저나 RLS 우회 권한을 부여하지 않습니다.

## SOLAPI

현재는 모의 커넥터만 활성화되어 있습니다. 실제 계정의 비밀값은 채팅에 올리지 않고 서버 환경에 설정합니다.

- `SOLAPI_TENANT_ID`: 이 계정이 연결될 단일 테넌트
- `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`
- `SOLAPI_LIVE_ENABLED`: 기본 false. 실제 전송 준비가 끝난 뒤에만 true
- 해당 테넌트의 connectors에 provider=solapi를 생성하고, 계정·등록 발신번호·080 검증을 거쳐 status와 capabilities를 변경합니다.
- mock과 solapi를 동시에 두면 실제 공급자를 우선 선택합니다. 따라서 검증 전에는 solapi 상태를 not_configured로 유지해야 합니다.

080 목록은 페이지가 끝날 때까지 조회하며, 실패한 조회는 최근 동기화 시각을 갱신하지 않습니다. 60초보다 오래된 080 상태와 검증되지 않은 공급자 기능은 발송을 차단합니다. 외부 거부 전파 실패는 제한된 재시도 뒤 manual_required로 남깁니다. 같은 공급자 계정을 여러 테넌트에 공유하지 않습니다.

HMAC 요청, 목록 스키마, 페이지 루프, 타임아웃은 모의 응답으로 검증했습니다. 실제 발송·080·취소 결과는 아직 확인하지 않았습니다.

공급자 접수 여부를 모르는 `unknown`을 임의로 queued로 바꾸지 않습니다. 공급자 이력과 식별자를 조사하고 확인한 결과만 서명 브리지로 입력합니다. 이미 공급자에 접수된 문자는 회수가 보장되지 않습니다.

## 격리 브라우저 검사

```sh
# .env에 스캐너 전용 무작위 토큰을 설정한 뒤
# SCAN_RUNNER_TOKEN=...
# SCAN_RUNNER_URL=http://127.0.0.1:4321
docker compose -f compose.scanner.yml up --build -d
```

스캐너에는 DB·문자 공급자·마스터 키를 넘기지 않습니다. Chromium은 비루트 사용자·sandbox·읽기 전용 루트·제한된 CPU/메모리·네트워크에서 실행하도록 구성했습니다. 외부 네트워크는 별도 egress 컨테이너만 연결됩니다. 프록시는 HTTPS CONNECT의 모든 DNS 응답을 확인하고 공인 IPv4 한 주소로 연결을 고정합니다. 사설 IP, 메타데이터, IPv6 우회, 공인/사설 혼합 응답, 비443 포트는 거절합니다.

검사는 소유 확인된 사이트의 게시 설정을 사용해 미선택·거절·분석만·전체 허용·철회 후 재방문을 비교합니다. 요청은 query와 fragment를 제거한 경로로, 쿠키는 이름과 도메인만 기록합니다. 인증된 사용자 정보나 실제 고객 비밀번호를 입력하지 않습니다.

현재 Mac에서 Docker 서비스가 실행되지 않아 이미지 빌드·컨테이너 실행은 검증하지 못했습니다. Linux 호스트의 seccomp/user namespace 지원이 필요합니다. 지원되지 않아 Chromium sandbox가 시작되지 않으면 실패로 남기며 `--no-sandbox`로 우회하지 않습니다.

`apps/scanner/seccomp.json`은 Playwright v1.63.0의 공식 프로필입니다. 출처: https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json (Apache-2.0).

## 삭제와 복구

삭제 요청은 우선 사용 제한과 철회를 적용합니다. 자체 연락처·고객사 CRM·백업 확인을 개별 작업으로 남기며, 외부 확인 전에는 완료로 표시하지 않습니다. 자체 CMP 작업 확인은 암호문을 제거합니다. 별도 근거·기간이 승인된 증빙은 보유 정책으로 처리합니다.

보유기간 종료 파기는 승인된 retention policy, 실제 deleted_at, 활성 보존 중지 없음, 외부 작업 완료를 모두 검사합니다. 원장은 일반 UPDATE/DELETE가 금지되어 있고, 조건을 검사하는 제한된 DB 함수만 보유기간 종료 삭제를 수행합니다.

삭제 이력은 백업과 별도 위치에 정기적으로 내보내고, 복원 후 광고 재개 전에 다시 적용합니다.

```sh
npx tsx scripts/deletion-journal.ts export TENANT_UUID /secure-separate-volume/deletions.json
# DB 복원 후, 같은 서명키를 안전하게 복구한 다음
npx tsx scripts/deletion-journal.ts apply /secure-separate-volume/deletions.json
```

복구 테스트는 이전 상태가 다시 들어온 상황에서 삭제 이력을 재적용하여 연락처를 다시 지우고 사용을 차단하는 절차를 실제 PostgreSQL에서 확인했습니다. 전체 운영 DB·객체 저장소·백업 매체의 복원 훈련을 대신하지 않습니다.

## 장애 시

- DB 불가: 성공 또는 허용으로 응답하지 않고 503. 선택적 웹 태그도 설정 실패 시 로딩하지 않음.
- 철회 기록 실패: 성공 화면을 표시하지 않음. 재시도 필요.
- 공급자 타임아웃: unknown. 자동 중복 전송 금지.
- 080 동기화 실패: 최신 확인 시각을 갱신하지 않음. 오래된 상태의 발송 금지.
- 통지 실패/삭제 미확인: 담당자 작업으로 남김. 완료로 허위 표시하지 않음.
- 요금 한도 초과: 신규 광고 제한. 철회·거부 기능 유지.
