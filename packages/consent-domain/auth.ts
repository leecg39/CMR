import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../database/index.js";
import {
  hash,
  passwordCheck,
  passwordHash,
  token,
  fail,
  safeEqual,
  encrypt,
  decrypt,
  type Context,
} from "./common.js";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(b: Buffer) {
  let bits = 0,
    value = 0,
    out = "";
  for (const x of b) {
    value = (value << 8) | x;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string) {
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret: string, step: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", unbase32(secret)).update(b).digest(),
    o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export function verifyTotp(
  secret: string,
  code: string,
  last = -1,
  now = Date.now(),
) {
  const s = Math.floor(now / 30000);
  for (const offset of [-1, 0, 1])
    if (s + offset > last && safeEqual(totp(secret, s + offset), code))
      return s + offset;
  return null;
}
export async function login(email: string, password: string, code?: string) {
  const {
    rows: [u],
  } = await pool.query("SELECT * FROM users WHERE email=$1", [
    email.toLowerCase(),
  ]);
  if (!u || !passwordCheck(password, u.password_hash))
    fail("INVALID_CREDENTIALS", 401);
  if (u.mfa_secret) {
    if (!code) fail("MFA_REQUIRED", 401);
    const step = verifyTotp(
      decrypt("auth", u.mfa_secret),
      code!,
      Number(u.mfa_last_step),
    );
    if (step === null) fail("INVALID_MFA", 401);
    const r = await pool.query(
      "UPDATE users SET mfa_last_step=$2 WHERE id=$1 AND mfa_last_step<$2",
      [u.id, step],
    );
    if (!r.rowCount) fail("MFA_REPLAY", 401);
  } else if (process.env.REQUIRE_MFA === "true")
    fail("MFA_SETUP_REQUIRED", 403);
  const {
    rows: [m],
  } = await pool.query(
    "SELECT tenant_id FROM memberships WHERE user_id=$1 ORDER BY tenant_id LIMIT 1",
    [u.id],
  );
  if (!m) fail("NO_MEMBERSHIP", 403);
  const secret = token();
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
    [hash(secret), u.id, m.tenant_id],
  );
  return secret;
}
export async function authenticate(
  secret?: string,
  bearer?: string,
): Promise<Context> {
  if (bearer) {
    const {
      rows: [k],
    } = await pool.query(
      "SELECT * FROM api_keys WHERE token_hash=$1 AND revoked_at IS NULL",
      [hash(bearer)],
    );
    if (!k) fail("UNAUTHENTICATED", 401);
    return {
      tenant: k.tenant_id,
      actor: `key:${k.id}`,
      role: "api",
      scopes: k.scopes,
    };
  }
  if (!secret) fail("UNAUTHENTICATED", 401);
  const {
    rows: [s],
  } = await pool.query(
    "SELECT s.user_id,s.tenant_id,m.role FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(secret!)],
  );
  if (!s) fail("UNAUTHENTICATED", 401);
  return { tenant: s.tenant_id, actor: s.user_id, role: s.role };
}
export async function beginMfa(user: string) {
  const secret = base32(randomBytes(20));
  await pool.query("UPDATE users SET mfa_pending=$2 WHERE id=$1", [
    user,
    encrypt("auth", secret),
  ]);
  return {
    secret,
    uri: `otpauth://totp/Consent%20Operations:${user}?secret=${secret}&issuer=Consent%20Operations`,
  };
}
export async function finishMfa(user: string, code: string) {
  const {
    rows: [u],
  } = await pool.query("SELECT mfa_pending FROM users WHERE id=$1", [user]);
  if (!u?.mfa_pending) fail("MFA_SETUP_REQUIRED");
  const step = verifyTotp(decrypt("auth", u.mfa_pending), code);
  if (step === null) fail("INVALID_MFA");
  await pool.query(
    "UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_last_step=$2 WHERE id=$1",
    [user, step],
  );
}
export async function newUser(email: string, password: string, name: string) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4)",
    [id, email, passwordHash(password), name],
  );
  return id;
}
