import { randomUUID } from "node:crypto";
import { pool, transaction } from "../database/index.js";
import { hash, type Context } from "../consent-domain/common.js";
import {
  createSubject,
  addContact,
  recordConsent,
} from "../consent-domain/consent.js";
export const NOW = new Date("2026-09-30T02:00:00Z");
export async function fixture(
  options: { sms?: boolean; legacy?: boolean; limit?: number } = {},
) {
  const tenant = randomUUID(),
    controller = randomUUID(),
    ctx: Context = { tenant, actor: "fixture", role: "owner" };
  await pool.query("INSERT INTO tenants(id,name,ad_limit) VALUES($1,$2,$3)", [
    tenant,
    "검증용 " + tenant,
    options.limit ?? 1000,
  ]);
  return transaction(tenant, async (db) => {
    await db.query(
      "INSERT INTO controllers(tenant_id,id,name,sender,opt_out) VALUES($1,$2,'가상상점','0200000001','0800000001')",
      [tenant, controller],
    );
    const purposes: Record<string, string> = {},
      notices: Record<string, string> = {};
    for (const [key, kind, channel] of [
      ["marketing_use", "personal_info", ""],
      ["ad_sms", "advertising_reception", "sms"],
      ["ad_email", "advertising_reception", "email"],
      ["advertising", "web_tracking", ""],
      ["analytics", "web_tracking", ""],
    ]) {
      const id = randomUUID(),
        nid = randomUUID();
      await db.query(
        "INSERT INTO purposes(tenant_id,id,controller_id,key,name,kind,channel,reviewed) VALUES($1,$2,$3,$4,$4,$5,$6,true)",
        [tenant, id, controller, key, kind, channel],
      );
      await db.query(
        "INSERT INTO notices(tenant_id,id,purpose_id,version,body,hash,status,published_at) VALUES($1,$2,$3,1,'광고성 정보에 동의하며 언제든 철회할 수 있습니다.',$4,'published',now())",
        [tenant, nid, id, hash("notice")],
      );
      purposes[key] = id;
      notices[key] = nid;
    }
    const connector = randomUUID();
    await db.query(
      "INSERT INTO connectors(tenant_id,id,provider,status,capabilities) VALUES($1,$2,'mock','active','{\"verified\":true}')",
      [tenant, connector],
    );
    const subject = await createSubject(db, ctx, {
        external_id: "fixture-member",
      }),
      contact = await addContact(db, ctx, {
        subject_id: subject.id,
        channel: "sms",
        value: "01000009999",
        verified: true,
      });
    const grant = async (key: string) =>
      recordConsent(
        db,
        ctx,
        {
          subject_id: subject.id,
          contact_id: key === "ad_sms" ? contact.id : null,
          purpose_id: purposes[key],
          notice_id: notices[key],
          action: "granted",
          occurred_at: "2026-09-29T01:00:00Z",
          idempotency_key: `grant:${key}`,
        },
        { now: NOW, legacy: options.legacy && key === "ad_sms" },
      );
    await grant("marketing_use");
    if (options.sms !== false) await grant("ad_sms");
    const template = randomUUID(),
      body =
        "(광고) 가상상점\n고객센터: 02-0000-0001\n신상품 소식입니다.\n무료수신거부 0800000001";
    await db.query(
      "INSERT INTO templates(tenant_id,id,controller_id,purpose_id,name,channel,route,message_class,body,status,hash) VALUES($1,$2,$3,$4,'가상 메시지','sms','lms','marketing',$5,'approved',$6)",
      [tenant, template, controller, purposes.ad_sms, body, hash(body + "\n")],
    );
    return {
      ctx,
      tenant,
      controller,
      purposes,
      notices,
      connector,
      subject: subject.id,
      contact: contact.id,
      template,
      input: {
        subject_id: subject.id,
        contact_id: contact.id,
        template_id: template,
      },
    };
  });
}
