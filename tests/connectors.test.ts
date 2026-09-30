import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchOptouts } from "../packages/connectors/solapi-sync.js";
import { submitSolapi } from "../packages/connectors/index.js";
process.env.SOLAPI_API_KEY = "test-key";
process.env.SOLAPI_API_SECRET = "test-secret";
process.env.SOLAPI_TENANT_ID = "test-tenant";
test("SOLAPI 080 목록은 모든 페이지를 처리하고 인증 헤더를 보낸다", async () => {
  let count = 0;
  const fetcher = (async (url: any, init: any) => {
    assert.match(init.headers.Authorization, /HMAC-SHA256 apiKey=test-key/);
    assert.ok(String(url).startsWith("https://api.solapi.com/iam/v1/black/"));
    count++;
    return new Response(
      JSON.stringify({
        blackList: [
          {
            handleKey: String(count),
            senderNumber: "0200000001",
            recipientNumber: "01000000001",
            dateUpdated: "2026-09-30",
          },
        ],
        nextKey: count === 1 ? "page-2" : null,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  assert.equal((await fetchOptouts(fetcher)).length, 2);
  assert.equal(count, 2);
});
test("SOLAPI 080 조회 실패·잘못된 응답·페이지 순환은 성공으로 처리하지 않는다", async () => {
  await assert.rejects(
    fetchOptouts(
      (async () => new Response("{}", { status: 503 })) as typeof fetch,
    ),
  );
  await assert.rejects(
    fetchOptouts(
      (async () => new Response("{}", { status: 200 })) as typeof fetch,
    ),
  );
  await assert.rejects(
    fetchOptouts(
      (async () =>
        new Response(
          JSON.stringify({ blackList: [], nextKey: "same" }),
        )) as typeof fetch,
    ),
    /PAGINATION_LOOP/,
  );
});
test("SOLAPI 실발송은 명시적 설정 및 테넌트 일치가 필요하고 타임아웃을 재발송하지 않는다", async () => {
  const m = {
    id: "job",
    tenant: "test-tenant",
    to: "01000000001",
    from: "0200000001",
    body: "합성 테스트",
    route: "sms",
  };
  delete process.env.SOLAPI_LIVE_ENABLED;
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw Error("timeout");
  }) as typeof fetch;
  assert.equal((await submitSolapi(m, fetcher)).kind, "rejected");
  process.env.SOLAPI_LIVE_ENABLED = "true";
  assert.equal(
    (await submitSolapi({ ...m, tenant: "other" }, fetcher)).kind,
    "rejected",
  );
  assert.equal(calls, 0);
  assert.equal((await submitSolapi(m, fetcher)).kind, "unknown");
  assert.equal(calls, 1);
  delete process.env.SOLAPI_LIVE_ENABLED;
});
test("격리 스캐너 egress 프록시는 DNS 응답 전체를 확인하고 공인 IP로 고정한다", async () => {
  const { resolvePublic } = await import("../apps/scanner/proxy.js");
  assert.equal(
    await resolvePublic(
      "owned.example",
      async () => [{ address: "8.8.8.8", family: 4 }] as any,
    ),
    "8.8.8.8",
  );
  await assert.rejects(
    resolvePublic(
      "owned.example",
      async () =>
        [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ] as any,
    ),
  );
  await assert.rejects(
    resolvePublic(
      "owned.example",
      async () => [{ address: "169.254.169.254", family: 4 }] as any,
    ),
  );
  await assert.rejects(resolvePublic("example:443"));
});
