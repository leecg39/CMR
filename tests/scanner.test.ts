import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createScanGateway } from "../apps/scanner/gateway.js";

test("스캐너 게이트웨이: 인증·정해진 경로·크기 제한·실패 응답을 실제 HTTP로 검증", async () => {
  let calls = 0;
  const upstream = http.createServer(async (req, res) => {
    calls++;
    assert.equal(req.url, "/scan");
    assert.equal(req.headers.authorization, "Bearer local-test-token");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(body, '{"domain":"example.com","tags":[]}');
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "failed", controlled_paths_pass: false }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/scan`;
  const gateway = createScanGateway(target, "local-test-token");
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const request = (route: string, body?: string, auth?: string) =>
    fetch(origin + route, {
      method: body === undefined ? "GET" : "POST",
      headers: auth ? { Authorization: auth } : {},
      body,
      signal: AbortSignal.timeout(5000),
    });
  try {
    assert.equal((await request("/scan", "{}")).status, 401);
    assert.equal((await request("/scan", "{}", "Bearer wrong")).status, 401);
    assert.equal(
      (
        await request(
          "/scan",
          "{}",
          "Bearer " + "é".repeat("local-test-token".length),
        )
      ).status,
      401,
    );
    assert.equal(
      (await request("/other", "{}", "Bearer local-test-token")).status,
      404,
    );
    assert.equal((await request("/scan")).status, 404);
    assert.equal(
      (await request("/scan", "a".repeat(20001), "Bearer local-test-token"))
        .status,
      413,
    );
    assert.equal(calls, 0);
    const valid = await request(
      "/scan",
      '{"domain":"example.com","tags":[]}',
      "Bearer local-test-token",
    );
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), {
      status: "failed",
      controlled_paths_pass: false,
    });
    assert.equal(calls, 1);
    await new Promise<void>((resolve, reject) =>
      upstream.close((e) => (e ? reject(e) : resolve())),
    );
    const failed = await request("/scan", "{}", "Bearer local-test-token");
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), {
      status: "failed",
      warnings: ["ISOLATED_SCAN_UNAVAILABLE"],
    });
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    if (upstream.listening)
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
