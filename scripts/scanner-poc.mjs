import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "dotenv";

// The same probe is streamed into the product container; it never uses the operator's browser.
if (process.argv.includes("--inside")) {
  const checks = [];
  const check = async (name, run) => {
    const details = await run();
    checks.push({ name, status: "passed", details });
  };
  try {
    await check("비루트·capabilities 없음·읽기 전용 루트", async () => {
      assert.notEqual(process.getuid(), 0);
      const status = fs.readFileSync("/proc/self/status", "utf8");
      assert.match(status, /CapEff:\s+0+\n/);
      assert.match(status, /NoNewPrivs:\s+1\n/);
      assert.throws(() => fs.writeFileSync("/app/poc-readonly-check", "x"), {
        code: "EROFS",
      });
      for (const key of [
        "DATABASE_URL",
        "CMP_MASTER_KEY",
        "SESSION_SECRET",
        "SOLAPI_API_KEY",
        "SOLAPI_API_SECRET",
      ])
        assert.equal(process.env[key], undefined, key);
      return { uid: process.getuid(), application_secrets_present: false };
    });
    const connects = (host, port, connectTarget) =>
      new Promise((resolve) => {
        const socket = net.connect({ host, port });
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          socket.destroy();
          resolve(value);
        };
        socket.setTimeout(2000, () => finish(false));
        socket.once("error", () => finish(false));
        socket.once("end", () => finish(false));
        socket.once("connect", () => {
          if (!connectTarget) finish(true);
          else
            socket.write(
              `CONNECT ${connectTarget} HTTP/1.1\r\nHost: ${connectTarget}\r\n\r\n`,
            );
        });
        socket.once("data", (data) =>
          finish(String(data).startsWith("HTTP/1.1 200")),
        );
      });
    await check("직접 egress 거부와 공인 HTTPS 프록시 허용", async () => {
      assert.equal(await connects("1.1.1.1", 443), false);
      assert.equal(await connects("egress", 4322, "1.1.1.1:443"), true);
      return { direct_public_tcp: false, proxy_public_https: true };
    });
    await check("프록시 사설·메타데이터·비443·IPv6 대상 거부", async () => {
      const targets = [
        "127.0.0.1:443",
        "10.0.0.1:443",
        "169.254.169.254:443",
        "1.1.1.1:80",
        "[::1]:443",
      ];
      for (const target of targets)
        assert.equal(await connects("egress", 4322, target), false, target);
      return { rejected_targets: targets };
    });
    await check(
      "실제 Chromium sandbox·renderer·프록시 HTTPS 실행",
      async () => {
        const { chromium } = await import("playwright-core");
        const browser = await chromium.launch({
          headless: true,
          chromiumSandbox: true,
          proxy: { server: process.env.SCAN_EGRESS_PROXY },
          args: [
            "--proxy-bypass-list=<-loopback>",
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          ],
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: "/tmp",
            TZ: "Asia/Seoul",
          },
        });
        try {
          const context = await browser.newContext({
            serviceWorkers: "block",
            acceptDownloads: false,
          });
          const page = await context.newPage();
          const response = await page.goto("https://1.1.1.1/cdn-cgi/trace", {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
          assert.equal(response.status(), 200);
          assert.ok((await page.textContent("body")).length > 0);
          return {
            chromium: browser.version(),
            sandbox: true,
            https_status: response.status(),
          };
        } finally {
          await browser.close();
        }
      },
    );
    await check("내부 스캐너 API 인증 거부", async () => {
      const response = await fetch("http://127.0.0.1:4321/scan", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 401);
    });
    console.log(JSON.stringify({ status: "passed", checks }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  const output = "artifacts/poc/scanner.json";
  const report = {
    started_at: new Date().toISOString(),
    status: "running",
    checks: [],
    configuration_sha256: createHash("sha256")
      .update(fs.readFileSync("compose.scanner.yml"))
      .update(fs.readFileSync("apps/scanner/seccomp.json"))
      .digest("hex"),
  };
  const docker = (args, input) =>
    execFileSync("docker", args, {
      env: process.env,
      encoding: "utf8",
      input,
      timeout: 100000,
      maxBuffer: 2_000_000,
    });
  try {
    const containers = JSON.parse(
      docker([
        "inspect",
        "cmp-poc-scanner-1",
        "cmp-poc-egress-1",
        "cmp-poc-gateway-1",
      ]),
    );
    report.containers = containers.map((c) => ({
      name: c.Name,
      image: c.Image,
      user: c.Config.User,
      running: c.State.Running,
      readonly: c.HostConfig.ReadonlyRootfs,
      cap_drop: c.HostConfig.CapDrop,
      security: c.HostConfig.SecurityOpt,
      memory: c.HostConfig.Memory,
      cpus: c.HostConfig.NanoCpus,
      pids_limit: c.HostConfig.PidsLimit,
      networks: Object.keys(c.NetworkSettings.Networks),
      ports: c.NetworkSettings.Ports,
    }));
    const scanner = report.containers.find(
      (c) => c.name === "/cmp-poc-scanner-1",
    );
    assert.deepEqual(scanner.networks, ["cmp-poc_isolated"]);
    assert.equal(scanner.readonly, true);
    assert.deepEqual(scanner.cap_drop, ["ALL"]);
    assert.ok(scanner.memory > 0 && scanner.cpus > 0 && scanner.pids_limit > 0);
    report.checks.push({
      name: "실제 컨테이너 격리망·파일시스템·자원 제한",
      status: "passed",
    });
    report.docker = JSON.parse(
      docker(["version", "--format", "{{json .Server}}"]),
    ).Version;
    const inside = JSON.parse(
      docker(
        [
          "exec",
          "-i",
          "cmp-poc-scanner-1",
          "node",
          "--input-type=module",
          "-",
          "--inside",
        ],
        fs.readFileSync(import.meta.filename, "utf8"),
      ),
    );
    assert.equal(inside.status, "passed");
    report.checks.push(...inside.checks);
    const token = parse(
      fs.readFileSync(".local/scanner-poc.env"),
    ).SCAN_RUNNER_TOKEN;
    assert.ok(token);
    const unauthorized = await fetch("http://127.0.0.1:4321/scan", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(unauthorized.status, 401);
    const response = await fetch("http://127.0.0.1:4321/scan", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ domain: "example.com", tags: [] }),
      signal: AbortSignal.timeout(80000),
    });
    const result = await response.json();
    // example.com does not run this CMP: never report an installation success for it.
    assert.equal(result.status, "failed");
    assert.notEqual(result.controlled_paths_pass, true);
    report.checks.push({
      name: "호스트 API 연결·인증·SDK 없는 사이트의 실패 표시",
      status: "passed",
      details: {
        unauthorized_status: 401,
        scan_http_status: response.status,
        result,
      },
    });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    report.finished_at = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        status: report.status,
        checks: report.checks.length,
        output,
        error: report.error,
      }),
    );
  }
}
