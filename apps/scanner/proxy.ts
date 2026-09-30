import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { publicIP } from "../../packages/web-sdk/security.js";
export async function resolvePublic(
  host: string,
  resolver: typeof lookup = lookup,
) {
  if (!/^[a-z0-9.-]+$/i.test(host)) throw Error("invalid host");
  const all = await resolver(host, { all: true });
  if (!all.length || all.some((a) => !publicIP(a.address)))
    throw Error("private or unsupported address");
  return all[0].address;
}
export function createEgressProxy() {
  let active = 0;
  const server = http.createServer((_req, res) => {
    res.writeHead(403);
    res.end("HTTPS CONNECT only");
  });
  server.on("connect", async (req, client, head) => {
    if (active >= 32) {
      client.destroy();
      return;
    }
    active++;
    client.once("close", () => active--);
    const target = /^([a-z0-9.-]+):443$/i.exec(req.url ?? "");
    if (!target) {
      client.destroy();
      return;
    }
    try {
      const address = await resolvePublic(target[1]);
      const upstream = net.connect({ host: address, port: 443 });
      upstream.setTimeout(10000, () => upstream.destroy());
      if (client instanceof net.Socket)
        client.setTimeout(10000, () => client.destroy());
      let bytes = 0;
      upstream.on("data", (data) => {
        bytes += data.length;
        if (bytes > 20_000_000) upstream.destroy();
      });
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    } catch {
      client.destroy();
    }
  });
  return server;
}
if (process.argv[1]?.endsWith("/proxy.ts"))
  createEgressProxy().listen(4322, "0.0.0.0", () =>
    console.log("Restricted egress proxy ready"),
  );
