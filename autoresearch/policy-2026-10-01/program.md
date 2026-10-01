# 발송 허용 판단 SQL 최적화

- 목표: 동의·권한·증빙 판단을 유지하면서 마케팅 허용 판단의 DB 호출 수를 줄인다.
- Iterations: 3
- 변경 가능 대상(target): `packages/policy-engine/index.ts`의 `evaluate` 내부 조회만.
- 고정 평가(prepare): 이 폴더의 `prepare.ts`. 기준 측정 이후 수정 금지.
- 주 지표: 허용 판단 1건당 SQL 호출 수. 낮을수록 좋다. 트랜잭션의 BEGIN, tenant 설정, 직렬화 잠금, COMMIT은 제외한다.
- 검증: `node --import tsx autoresearch/policy-2026-10-01/prepare.ts artifacts/autoresearch/2026-10-01/<label>.json`
- 실험 자동 판정은 출력 경로 뒤에 직전 최선 JSON과 최초 `baseline.json` 경로를 추가한다. 지표·지연 조건 위반 시 exit code 1이다.
- 환경: 매 실행마다 신규 PostgreSQL DB와 NOSUPERUSER/NOBYPASSRLS 비소유자 역할. 실제 RLS 활성화. 합성 데이터만 사용하고 종료 시 자신의 DB/역할을 삭제한다.
- 지연 관측: 워밍업 20건, 100건·동시성 5를 5회 측정하여 p95의 중앙값을 기록한다. 운영 SLA를 나타내지 않는다.
- 유지 조건: SQL 호출 수가 최소 1회 감소하고, 고정 의미 검증 및 기존 `npm test`·`npm run build`가 통과하며 p95 중앙값이 최초 기준의 120% 이하이다.
- 롤백: 단일 가설을 먼저 커밋한 후 검증한다. 유지 조건을 충족하지 않으면 git revert로 복원한다.
- 금지: 평가·기존 테스트 수정, RLS/트랜잭션 잠금 제거, 판단/증빙 생략, 실제 SMS 전송, 실연동 설정 변경.
- 3회 종료 시 모든 결과를 `results.tsv`와 보고서에 기록한다. 보류된 SOLAPI·080 실연동은 범위 밖이다.
