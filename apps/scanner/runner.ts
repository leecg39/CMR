/** Product scanner service; never uses the operator's browser or cookies. Run only in the isolated container network. */
import http from "node:http";
import { chromium } from "playwright-core";
import { z } from "zod";
import { safeEqual } from "../../packages/consent-domain/common.js";
const input = z
  .object({
    domain: z.string().regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/),
    tags: z
      .array(
        z.object({
          src: z.url(),
          purpose: z.enum(["analytics", "advertising"]),
        }),
      )
      .max(50),
  })
  .strict();
function sanitized(url: string) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "invalid";
  }
}
export async function scan(inputData: z.infer<typeof input>) {
  if (!process.env.SCAN_EGRESS_PROXY)
    throw Error("isolated egress proxy required");
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
  const timer = setTimeout(() => void browser.close(), 70000);
  const results = [];
  try {
    for (const scenario of ["none", "reject", "analytics", "all", "revoke"]) {
      const context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      const page = await context.newPage();
      const requests: string[] = [],
        errors: string[] = [];
      let requestCount = 0;
      await context.route("**/*", async (route) => {
        const r = route.request(),
          url = new URL(r.url());
        if (
          ++requestCount > 200 ||
          url.protocol !== "https:" ||
          (r.isNavigationRequest() &&
            r.frame() === page.mainFrame() &&
            url.hostname !== inputData.domain)
        ) {
          await route.abort();
          return;
        }
        requests.push(sanitized(url.href));
        await route.continue();
      });
      page.on("pageerror", () => errors.push("PAGE_SCRIPT_ERROR"));
      await page.goto("https://" + inputData.domain, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      const sdk = await page.locator("#cmp-consent").count();
      if (sdk && scenario !== "none") {
        await page
          .getByRole("button", { name: "개인정보 설정", exact: true })
          .click({ timeout: 3000 });
        if (scenario === "analytics") {
          await page.locator("#cmp-consent input[name=analytics]").check();
          await page
            .getByRole("button", { name: "선택 저장", exact: true })
            .click();
        } else if (scenario === "reject")
          await page
            .getByRole("button", { name: "모두 거절", exact: true })
            .click();
        else {
          await page
            .getByRole("button", { name: "모두 허용", exact: true })
            .click();
          if (scenario === "revoke") {
            await page
              .getByRole("button", { name: "개인정보 설정", exact: true })
              .click();
            await page
              .getByRole("button", { name: "모두 거절", exact: true })
              .click();
            requests.length = 0;
            await page.reload({ waitUntil: "domcontentloaded" });
          }
        }
      }
      await page.waitForTimeout(500);
      const cookies = (await context.cookies()).map((c) => ({
        name: c.name,
        domain: c.domain,
      }));
      const expected = inputData.tags
        .filter(
          (t) =>
            scenario === "all" ||
            (scenario === "analytics" && t.purpose === "analytics"),
        )
        .map((t) => sanitized(t.src));
      const executed = inputData.tags
        .filter((t) => requests.includes(sanitized(t.src)))
        .map((t) => sanitized(t.src));
      const unexpected = executed.filter((t) => !expected.includes(t)),
        missing = expected.filter((t) => !executed.includes(t));
      results.push({
        scenario,
        sdk_detected: !!sdk,
        pass: !!sdk && !unexpected.length && !missing.length,
        expected,
        executed,
        unexpected,
        missing,
        requests: [...new Set(requests)],
        cookies,
        errors,
      });
      await context.close();
    }
    return {
      status: results.every((r) => r.pass) ? "partial" : "failed",
      controlled_paths_pass: results.every((r) => r.pass),
      warnings: [
        "UNREGISTERED_TAGS_REQUIRE_REVIEW",
        "USER_INTERACTIONS_NOT_EXHAUSTIVE",
      ],
      scenarios: results,
    };
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
let running = false;
http
  .createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/scan") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (
      !process.env.SCAN_RUNNER_TOKEN ||
      !safeEqual(
        req.headers.authorization ?? "",
        "Bearer " + process.env.SCAN_RUNNER_TOKEN,
      )
    ) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (running) {
      res.writeHead(429);
      res.end();
      return;
    }
    running = true;
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 20000) throw Error("body limit");
      }
      const data = input.parse(JSON.parse(body));
      running = true;
      const report = await scan(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(report));
    } catch {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "failed",
          warnings: ["ISOLATED_SCAN_FAILED"],
        }),
      );
    } finally {
      running = false;
    }
  })
  .listen(4321, "0.0.0.0");
