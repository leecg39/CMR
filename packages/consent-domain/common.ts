import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: string[],
  ) {
    super(code);
  }
}
export const fail = (code: string, status = 400, details?: string[]): never => {
  throw new AppError(code, status, details);
};
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const passwordHash = (v: string) => {
  const s = randomBytes(16).toString("hex");
  return `${s}:${scryptSync(v, s, 64).toString("hex")}`;
};
export const passwordCheck = (v: string, h: string) => {
  const [s, k] = h.split(":");
  return safeEqual(scryptSync(v, s, 64).toString("hex"), k);
};
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
const key = (t: string) => {
  const master = Buffer.from(process.env.CMP_MASTER_KEY ?? "", "base64");
  if (master.length !== 32) throw Error("CMP_MASTER_KEY must be 32 bytes");
  return createHmac("sha256", master).update(t).digest();
};
export const contactHash = (t: string, v: string) =>
  createHmac("sha256", key(t)).update(v).digest("hex");
export function encrypt(t: string, v: string): string {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(t), iv);
  const data = Buffer.concat([c.update(v, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}
export function decrypt(t: string, v: string) {
  const b = Buffer.from(v, "base64"),
    c = createDecipheriv("aes-256-gcm", key(t), b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString();
}
export function kstDate(d: Date) {
  return new Date(d.getTime() + 9 * 3600000);
}
export function calendarDue(d: Date, years = 0, days = 0) {
  const k = kstDate(d),
    y = k.getUTCFullYear() + years,
    m = k.getUTCMonth(),
    day = Math.min(
      k.getUTCDate(),
      new Date(Date.UTC(y, m + 1, 0)).getUTCDate(),
    );
  return new Date(Date.UTC(y, m, day + days, 14, 59, 59, 999));
}
export const daytime = (d: Date) => {
  const h = kstDate(d).getUTCHours();
  return h >= 8 && h < 21;
};
export type Context = {
  tenant: string;
  actor: string;
  role: string;
  scopes?: string[];
};
export function permit(ctx: Context, permission: string) {
  if (ctx.role === "system" || ctx.role === "owner") return;
  if (ctx.role === "api") {
    if (ctx.scopes?.includes(permission)) return;
    fail("FORBIDDEN", 403);
  }
  const roles: Record<string, string[]> = {
    read: ["privacy_officer", "marketer", "developer", "auditor"],
    "consent:write": ["privacy_officer"],
    "policy:write": ["privacy_officer"],
    "messages:send": ["marketer", "privacy_officer"],
    decisions: ["marketer", "privacy_officer"],
    "evidence:read": ["privacy_officer"],
    "deletion:write": ["privacy_officer"],
    "sites:write": ["developer", "privacy_officer"],
  };
  if (!roles[permission]?.includes(ctx.role)) fail("FORBIDDEN", 403);
}
