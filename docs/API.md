# API 안내

기본 주소: `http://127.0.0.1:4310/v1`.

서버 간 API는 `Authorization: Bearer <서버 키>`와 `Content-Type: application/json`을 사용합니다. 키 발급은 콘솔의 조직·연동에서 할 수 있습니다. 본문에 tenant_id를 넣어 테넌트를 바꿀 수 없습니다. 예외는 비밀키로 인증한 운영 브리지 이벤트뿐입니다.

쿠키 인증의 변경 요청은 APP_ORIGIN과 일치하는 Origin 헤더가 필요합니다. 모든 결과는 `private, no-store`입니다. 오류는 `code`와 HTTP 상태로 반환됩니다. 모르는 입력 필드는 거절합니다.

| 경로 | 내용 | 권한 |
|---|---|---|
| POST /auth/login | email, password, 선택적 code | 공개, 요청 제한 |
| GET /me | 현재 사용자·소속 | 세션 |
| POST /auth/tenant | 소속 테넌트 전환 | 세션 |
| POST /auth/mfa/start, /auth/mfa/finish | TOTP 설정 | 세션 |
| GET /overview | 테넌트 운영 데이터 | read |
| POST /subjects | external_id로 회원 등록 | consent:write |
| POST /contacts | 연락처 등록·검증 이력 | consent:write |
| POST /consent-events | 동의·거부·철회 | consent:write |
| GET /subjects/:id/preferences | 상태·원장 | read |
| POST /decisions | 발송 사전 판단 | decisions |
| POST /messages | 예약 및 발송 대기 등록 | messages:send |
| POST /worker/run | 해당 테넌트의 작업 1회 실행 | messages:send |
| GET /evidence/:id?format=json 또는 csv | 증빙 내보내기, 감사 기록 | evidence:read |
| POST /notices, /notices/:id/publish | 문구 초안·검토 게시 | policy:write |
| POST /templates, /templates/:id/approve | 메시지 작성·승인 | policy:write |
| POST /revoke-links | 특정 주체·연락처·목적의 철회 링크 | consent:write |
| POST /preference-actions/revoke | 서명 링크로 철회 | 링크 토큰 |
| POST /provider-events/bridge | 정규화한 공급자 이벤트 | 브리지 서명 |
| POST /import | CSV/JSON 미리보기·확인 이관 | consent:write |
| POST /agreement-versions, /agreement-events | 서비스 약관 별도 원장 | 정책/동의 권한 |
| POST /identity-links | 검증된 브라우저·회원 연결, 동의 복사 없음 | consent:write |
| POST /deletion-requests | 본인 확인을 마친 삭제 요청 | deletion:write |
| POST /deletion-tasks/:id/confirm | 시스템별 삭제 결과 근거 | deletion:write |
| POST /retention-policy | 기간·근거 승인 | policy:write |
| POST /holds | 특정 주체에 대한 보존 중지 | deletion:write |
| POST /retention-purge | 보유기간 종료 파기 | deletion:write |
| POST /sites, /sites/:id/verify | 도메인 등록·DNS 확인 | sites:write |
| POST /sites/:id/scan | JavaScript 미실행 HTTP 검사 | sites:write |
| POST /sites/:id/browser-scan | 격리된 브라우저의 5개 상태 검사 | sites:write |
| POST /web-configs, /web-configs/:id/publish | 태그·배너 버전 관리 | 사이트/정책 권한 |
| POST /keys, DELETE /keys/:id | 키 발급·폐기 | 소유자 |
| POST /memberships | 구성원 추가 | 소유자 |
| POST /plan | 월 광고 요청 한도 | 소유자 |
| POST /tenant/suspend | 신규 광고 중단, 철회 유지 | 소유자 |

`policy:write`, `sites:write`, `org:write`는 콘솔 역할 권한입니다. 키 발급 UI는 허용된 서버 범위만 제공합니다. 동의 API의 회원 로그인 확인·연락처 검증은 고객사 서버가 완료한 뒤 호출해야 합니다. 브라우저 공개 사이트 키로는 회원 동의를 변경할 수 없습니다.

## 동의 요청 예

아래 UUID는 실제 생성된 식별자로 대체해야 합니다.

```json
{
  "subject_id": "회원 UUID",
  "contact_id": "연락처 UUID",
  "purpose_id": "문자 광고 목적 UUID",
  "notice_id": "게시 문구 UUID",
  "action": "granted",
  "occurred_at": "2026-09-30T01:00:00Z",
  "idempotency_key": "가입 제출마다 고유한 키",
  "expected_revision": 0
}
```

서버가 수신 시각·순서·검증 등급을 결정합니다. 철회에는 문구 버전이 필요하지 않습니다. 수신 동의는 연락처를 지정해야 하고, 개인정보 이용 동의는 contact_id를 생략합니다. 동의가 아닌 약관 수락은 별도 API로 보냅니다.

## 메시지

```json
{
  "subject_id": "회원 UUID",
  "contact_id": "연락처 UUID",
  "template_id": "승인된 템플릿 UUID",
  "idempotency_key": "캠페인-대상자-고유키",
  "scheduled_at": "2026-09-30T03:00:00Z"
}
```

발송 요청은 내용을 직접 받지 않습니다. 승인된 템플릿을 참조하며, 같은 멱등 키의 내용 변경은 409입니다. 예약 당시의 허용 결과와 관계없이 공급자 호출 직전에 재검사합니다. `unknown`은 자동 재발송하지 않습니다.

MMS 템플릿은 `route: "mms"`와 공급자에 이미 등록한 `image_id`가 필요합니다. 이미지 ID도 승인 해시에 포함됩니다. 업로드·이미지 규격 검증은 공급자 계정에서 먼저 수행합니다.

## 공급자 브리지

SOLAPI 자체 웹훅 서명 형식을 추정하지 않습니다. 공급자 수신 이벤트를 검증한 사내 브리지가 아래 형식으로 정규화하여 전달합니다. SOLAPI 080 목록 직접 조회 경로도 별도로 구현했습니다.

- `x-cmp-timestamp`: Unix 초
- `x-cmp-signature`: HMAC-SHA256(`timestamp + "." + JSON.stringify(body)`, `PROVIDER_BRIDGE_SECRET`), hex
- 5분 초과 및 잘못된 서명 거부, 이벤트 ID 중복 제거
- body: `{tenant_id, event_id, kind: "optout" | "delivered" | "failed", contact_id?, job_id?}`
- JSON 속성 순서까지 서명 생성과 동일하게 전달합니다. 브리지 비밀키는 사이트나 브라우저에 전달하지 않습니다.

## CSV 이관

```csv
external_id,phone,state
legacy-001,01000009001,granted
legacy-002,01000009002,revoked
```

`POST /import`에 `{csv: "...", commit: false}`로 미리보고 `commit: true`로 승인합니다. 증빙 없는 grant는 LEGACY_UNVERIFIED, 연락처는 미검증으로 남습니다. 과거 동의 날짜를 임의 생성하지 않습니다.
