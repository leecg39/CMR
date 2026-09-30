import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { pool, transaction } from "../packages/database/index.js";
import { hash, type Context } from "../packages/consent-domain/common.js";
import { newUser } from "../packages/consent-domain/auth.js";
import {
  createSubject,
  addContact,
  recordConsent,
} from "../packages/consent-domain/consent.js";
if ((await pool.query("SELECT count(*) FROM tenants")).rows[0].count !== "0")
  throw Error("기존 데이터가 있습니다. 시드를 중복 적용하지 않습니다.");
const password = randomBytes(16).toString("base64url"),
  user = await newUser("owner@cmp.test", password, "운영 담당자");
let serial = 0;
const result = [];
for (const [index, name] of [
  "모노 스토어",
  "배움 에듀",
  "온유 예약",
].entries()) {
  const tenant = randomUUID(),
    controller = randomUUID();
  await pool.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
    tenant,
    name,
  ]);
  await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [
    user,
    tenant,
  ]);
  const ctx: Context = { tenant, actor: user, role: "owner" };
  await transaction(tenant, async (db) => {
    await db.query(
      "INSERT INTO controllers(tenant_id,id,name,sender,opt_out) VALUES($1,$2,$3,$4,$5)",
      [
        tenant,
        controller,
        name,
        `020000000${index + 1}`,
        `080000000${index + 1}`,
      ],
    );
    const purposes: Record<string, string> = {},
      notices: Record<string, string> = {};
    for (const [key, label, kind, channel] of [
      ["marketing_use", "개인정보 마케팅 이용", "personal_info", ""],
      ["ad_sms", "문자 광고 수신", "advertising_reception", "sms"],
      ["ad_email", "이메일 광고 수신", "advertising_reception", "email"],
      ["analytics", "웹 분석", "web_tracking", ""],
      ["advertising", "웹 광고", "web_tracking", ""],
    ]) {
      const id = randomUUID(),
        notice = randomUUID(),
        body = `${name}의 ${label}에 선택적으로 동의합니다. 목적에 필요한 항목만 처리하며 설정에서 언제든 동의를 철회할 수 있습니다. 광고성 정보는 동의한 채널과 연락처에만 전송됩니다.`;
      await db.query(
        "INSERT INTO purposes(tenant_id,id,controller_id,key,name,kind,channel,reviewed) VALUES($1,$2,$3,$4,$5,$6,$7,true)",
        [tenant, id, controller, key, label, kind, channel],
      );
      await db.query(
        "INSERT INTO notices(tenant_id,id,purpose_id,version,body,hash,status,approved_by,published_at) VALUES($1,$2,$3,1,$4,$5,'published','synthetic_seed',now())",
        [tenant, notice, id, body, hash(body)],
      );
      purposes[key] = id;
      notices[key] = notice;
    }
    const connector = randomUUID();
    await db.query(
      "INSERT INTO connectors(tenant_id,id,provider,status,capabilities,last_optout_sync) VALUES($1,$2,'mock','active','{\"verified\":true,\"real_sms\":false}',now())",
      [tenant, connector],
    );
    const body = `(광고) ${name}\n고객센터: 02-0000-000${index + 1}\n\n이번 주 새롭게 준비한 상품을 확인해 보세요.\n\n무료수신거부 080000000${index + 1}`;
    await db.query(
      "INSERT INTO templates(tenant_id,id,controller_id,purpose_id,name,channel,route,message_class,body,status,hash,approved_by) VALUES($1,$2,$3,$4,'신상품 소식','sms','lms','marketing',$5,'approved',$6,'synthetic_seed')",
      [
        tenant,
        randomUUID(),
        controller,
        purposes.ad_sms,
        body,
        hash(body + "\n"),
      ],
    );
    for (let n = 0; n < (index === 0 ? 60 : 20); n++) {
      const s = await createSubject(db, ctx, {
          external_id: `member-${String(++serial).padStart(4, "0")}`,
        }),
        c = await addContact(db, ctx, {
          subject_id: s.id,
          channel: "sms",
          value: `0100000${String(serial).padStart(4, "0")}`,
          verified: true,
        }),
        at = new Date(Date.now() - 86400000 * 3).toISOString();
      if (n % 5 !== 4) {
        await recordConsent(db, ctx, {
          subject_id: s.id,
          purpose_id: purposes.marketing_use,
          notice_id: notices.marketing_use,
          action: "granted",
          occurred_at: at,
          idempotency_key: `seed:use:${s.id}`,
        });
        await recordConsent(
          db,
          ctx,
          {
            subject_id: s.id,
            contact_id: c.id,
            purpose_id: purposes.ad_sms,
            notice_id: notices.ad_sms,
            action: "granted",
            occurred_at: at,
            idempotency_key: `seed:sms:${s.id}`,
          },
          { legacy: n % 5 === 3 },
        );
      }
      if (n % 5 === 1 || n % 5 === 2)
        await recordConsent(db, ctx, {
          subject_id: s.id,
          contact_id: c.id,
          purpose_id: purposes.ad_sms,
          action: n % 5 === 1 ? "revoked" : "denied",
          idempotency_key: `seed:stop:${s.id}`,
        });
    }
  });
  result.push({ tenant, name });
}
fs.mkdirSync(".local", { recursive: true });
fs.writeFileSync(
  ".local/demo-access.json",
  JSON.stringify(
    { email: "owner@cmp.test", password, tenants: result },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "가상 테넌트 3개 · 합성 회원 100명 생성. 로그인 정보: .local/demo-access.json",
);
await pool.end();
