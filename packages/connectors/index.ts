import { createHmac, randomBytes } from "node:crypto";
export type Submission = {
  id: string;
  tenant: string;
  to: string;
  from: string;
  body: string;
  route: string;
  image_id?: string;
  title?: string;
};
export type Outcome =
  | { kind: "accepted"; provider_id: string }
  | { kind: "unknown" }
  | { kind: "rejected"; reason: string };
/** Credentials stay server-side. Production activation requires a verified 080 integration. */
export async function submitSolapi(
  m: Submission,
  fetcher: typeof fetch = fetch,
): Promise<Outcome> {
  if (
    process.env.SOLAPI_LIVE_ENABLED !== "true" ||
    process.env.SOLAPI_TENANT_ID !== m.tenant ||
    !process.env.SOLAPI_API_KEY ||
    !process.env.SOLAPI_API_SECRET
  )
    return { kind: "rejected", reason: "PROVIDER_NOT_CONFIGURED" };
  const date = new Date().toISOString(),
    salt = randomBytes(16).toString("hex"),
    signature = createHmac("sha256", process.env.SOLAPI_API_SECRET)
      .update(date + salt)
      .digest("hex");
  try {
    const r = await fetcher(
      "https://api.solapi.com/messages/v4/send-many/detail",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `HMAC-SHA256 apiKey=${process.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
        },
        body: JSON.stringify({
          messages: [
            {
              to: m.to,
              from: m.from,
              text: m.body,
              type: m.route.toUpperCase(),
              ...(m.route === "mms" ? { imageId: m.image_id } : {}),
              ...(m.title ? { subject: m.title } : {}),
              customFields: { cmpJobId: m.id },
            },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (r.status >= 500) return { kind: "unknown" };
    if (!r.ok) return { kind: "rejected", reason: `PROVIDER_HTTP_${r.status}` };
    const data = (await r.json()) as {
      groupInfo?: { groupId?: string };
      failedMessageList?: unknown[];
    };
    if (data.failedMessageList?.length)
      return { kind: "rejected", reason: "PROVIDER_REJECTED" };
    return data.groupInfo?.groupId
      ? { kind: "accepted", provider_id: data.groupInfo.groupId }
      : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
