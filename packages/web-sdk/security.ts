import { resolveTxt, lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { fail } from "../consent-domain/common.js";
export function publicIP(ip: string) {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return !(
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && (p[1] === 168 || p[1] === 0)) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19))
    );
  }
  /* IPv6 is unsupported until pinned egress filtering is deployed. */ return false;
}
export async function verifyDomain(domain: string, token: string) {
  try {
    return (await resolveTxt(`_cmp.${domain}`)).some(
      (parts) => parts.join("") === `cmp-verification=${token}`,
    );
  } catch {
    return false;
  }
}
// Node 22 connects with autoSelectFamily and asks lookup for {all:true}; answer both forms with the validated address only.
export const pinnedLookup =
  (address: string) => (_host: string, opts: any, cb: any) =>
    opts?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
export async function safeScan(domain: string) {
  if (!/^(?=.{1,253}$)[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain))
    fail("INVALID_DOMAIN");
  const addresses = await lookup(domain, { all: true });
  if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
    fail("UNSAFE_SCAN_TARGET");
  const address = addresses[0].address;
  return new Promise<{
    status: string;
    warnings: string[];
    requests: string[];
  }>((resolve, reject) => {
    const req = https.get(
      {
        hostname: domain,
        path: "/",
        port: 443,
        servername: domain,
        lookup: pinnedLookup(address),
        timeout: 8000,
        headers: { "User-Agent": "CMP-Install-Check/1.0" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error("Redirects and non-200 responses are not followed"));
          return;
        }
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy(Error("scan size limit"));
        });
        res.on("end", () => {
          const warnings = [
            "JAVASCRIPT_NOT_EXECUTED",
            "USER_INTERACTIONS_NOT_TESTED",
          ];
          if (!body.includes("/sdk/cmp.js")) warnings.push("SDK_MISSING");
          const scripts = [
            ...body.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi),
          ];
          if (
            scripts.some(
              (s) =>
                !s[0].includes("text/plain") && !s[1].includes("/sdk/cmp.js"),
            )
          )
            warnings.push("UNCONTROLLED_SCRIPTS");
          resolve({
            status: body.includes("/sdk/cmp.js") ? "partial" : "unverified",
            warnings,
            requests: scripts.map((s) => s[1]),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(Error("scan timeout")));
    req.on("error", reject);
  });
}
