import http from "node:http";
import { safeEqual } from "../../packages/consent-domain/common.js";

// The browser remains on the internal network. Only this trusted relay publishes the API.
export function createScanGateway(upstream: string, token: string) {
  let running = false;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/scan") {
      res.writeHead(404).end();
      return;
    }
    if (
      !token ||
      !safeEqual(req.headers.authorization ?? "", "Bearer " + token)
    ) {
      res.writeHead(401).end();
      return;
    }
    if (running) {
      res.writeHead(429).end();
      return;
    }
    running = true;
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 20000) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const reply = await fetch(upstream, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(75000),
        redirect: "error",
      });
      const result: Uint8Array[] = [];
      let size = 0;
      if (reply.body) {
        const reader = reply.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1_000_000) {
              await reader.cancel();
              throw Error("scan response limit");
            }
            result.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      res.writeHead(reply.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(Buffer.concat(result));
    } catch {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "failed",
          warnings: ["ISOLATED_SCAN_UNAVAILABLE"],
        }),
      );
    } finally {
      running = false;
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  return server;
}

if (process.argv[1]?.endsWith("/gateway.ts"))
  createScanGateway(
    "http://scanner:4321/scan",
    process.env.SCAN_RUNNER_TOKEN ?? "",
  ).listen(4323, "0.0.0.0", () =>
    console.log("Authenticated scan gateway ready"),
  );
