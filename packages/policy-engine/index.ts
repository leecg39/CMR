import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "../database/index.js";
import {
  fail,
  hash,
  daytime,
  permit,
  type Context,
} from "../consent-domain/common.js";
export const RULESET = "kr_sms_explicit_daytime_v1";
export const sendInput = z
  .object({ subject_id: z.uuid(), contact_id: z.uuid(), template_id: z.uuid() })
  .strict();
export function templateIssues(t: {
  body: string;
  message_class: string;
  route: string;
  title?: string;
  image_id?: string;
}) {
  const r: string[] = [];
  if (t.route === "mms" && !t.image_id) r.push("MMS_IMAGE_REQUIRED");
  if (t.message_class === "marketing") {
    if (t.route === "alimtalk") r.push("ADVERTISING_ALIMTALK_FORBIDDEN");
    if (!t.body.startsWith("(광고)")) r.push("AD_LABEL_REQUIRED");
    if (
      !/고객센터\s*[:：]\s*[0-9-]{8,}/.test(
        t.body.split("\n").slice(0, 3).join("\n"),
      )
    )
      r.push("SENDER_CONTACT_REQUIRED");
    if (!/무료수신거부\s*080[0-9-]{7,}/.test(t.body))
      r.push("FREE_OPTOUT_REQUIRED");
    if (t.title && !t.title.startsWith("(광고)"))
      r.push("TITLE_AD_LABEL_REQUIRED");
  } else if (/할인|쿠폰|적립금|특가|프로모션|이벤트 참여/.test(t.body))
    r.push("PROMOTIONAL_NOTICE_FORBIDDEN");
  if (/\{\{|\}\}/.test(t.body)) r.push("UNREVIEWED_VARIABLES");
  return r;
}
export async function evaluate(
  db: DB,
  ctx: Context,
  input: unknown,
  now = new Date(),
) {
  permit(ctx, "decisions");
  const i = sendInput.parse(input);
  const {
    rows: [entities],
  } = await db.query(
    `SELECT to_jsonb(s) AS subject, to_jsonb(c) AS contact,
            to_jsonb(t) AS template, to_jsonb(ctrl) AS controller
       FROM subjects s
       JOIN contact_points c ON c.tenant_id=s.tenant_id AND c.id=$2
       JOIN templates t ON t.tenant_id=s.tenant_id AND t.id=$3
       JOIN controllers ctrl ON ctrl.tenant_id=t.tenant_id AND ctrl.id=t.controller_id
      WHERE s.id=$1`,
    [i.subject_id, i.contact_id, i.template_id],
  );
  if (!entities) fail("NOT_FOUND", 404);
  const { subject: s, contact: c, template: t, controller } = entities;
  const r: string[] = [];
  if (c.subject_id !== s.id) fail("CONTACT_SCOPE_MISMATCH");
  if (s.restricted || s.deleted_at) r.push("SUBJECT_RESTRICTED");
  if (!c.active || !c.verified) r.push("CONTACT_UNVERIFIED");
  if (c.channel !== t.channel) r.push("CHANNEL_MISMATCH");
  if (
    t.status !== "approved" ||
    t.hash !==
      hash(
        t.body +
          "\n" +
          t.title +
          (t.route === "mms" ? "\nimage:" + t.image_id : ""),
      )
  )
    r.push("TEMPLATE_UNAPPROVED");
  r.push(...templateIssues(t));
  const {
    rows: [connector],
  } = await db.query(
    "SELECT * FROM connectors ORDER BY CASE provider WHEN 'solapi' THEN 0 ELSE 1 END LIMIT 1",
  );
  if (!connector || connector.status !== "active") r.push("PROVIDER_NOT_READY");
  if (
    connector?.provider === "solapi" &&
    (!connector.capabilities?.verified ||
      !connector.last_optout_sync ||
      now.getTime() - new Date(connector.last_optout_sync).getTime() > 60000)
  )
    r.push("OPTOUT_SYNC_UNVERIFIED");
  if (!controller.sender) r.push("SENDER_NOT_REGISTERED");
  if (t.route !== "sms" && t.route !== "lms" && t.route !== "mms")
    r.push("ROUTE_NOT_SUPPORTED");
  let revision = 0;
  if (t.message_class === "marketing") {
    if (!daytime(now)) r.push("OUTSIDE_DAYTIME");
    if (
      !t.body.includes(controller.name) ||
      !t.body.includes(controller.opt_out) ||
      !controller.opt_out.startsWith("080")
    )
      r.push("SENDER_OR_OPTOUT_MISMATCH");
    const {
      rows: [{ purpose: p, state, marketing_use: use }],
    } = await db.query(
      `SELECT
         (SELECT to_jsonb(p) FROM purposes p WHERE p.id=$3) AS purpose,
         (SELECT to_jsonb(c) FROM consent_current c
           WHERE c.subject_id=$1 AND c.contact_id=$2 AND c.purpose_id=$3) AS state,
         (SELECT to_jsonb(c) FROM consent_current c
           JOIN purposes p ON p.tenant_id=c.tenant_id AND p.id=c.purpose_id
          WHERE c.subject_id=$1 AND p.controller_id=$4
            AND p.kind='personal_info' AND p.key='marketing_use'
            AND p.reviewed AND p.lawful_basis='consent' LIMIT 1) AS marketing_use`,
      [s.id, c.id, t.purpose_id, t.controller_id],
    );
    if (t.purpose_id && !p) fail("NOT_FOUND", 404);
    if (
      !p ||
      p.controller_id !== t.controller_id ||
      p.channel !== c.channel ||
      p.kind !== "advertising_reception"
    )
      r.push("PURPOSE_SCOPE_MISMATCH");
    if (!p?.reviewed || p?.lawful_basis !== "consent")
      r.push("LAWFUL_BASIS_UNREVIEWED");
    revision = state?.revision ?? 0;
    if (state?.state !== "GRANTED")
      r.push(
        state?.state === "REVOKED"
          ? "CONSENT_WITHDRAWN"
          : "RECEPTION_CONSENT_MISSING",
      );
    else if (state.evidence !== "VERIFIED") r.push("EVIDENCE_UNVERIFIED");
    if (use?.state !== "GRANTED" || use?.evidence !== "VERIFIED")
      r.push("MARKETING_USE_CONSENT_MISSING");
    const blocked = await db.query(
      "SELECT 1 FROM suppressions WHERE active AND subject_id=$1 AND ((contact_id=$2 AND purpose_id=$4) OR (contact_id IS NULL AND purpose_id=$3))",
      [s.id, c.id, use?.purpose_id ?? null, t.purpose_id],
    );
    if (blocked.rowCount) r.push("SUPPRESSED");
    const {
      rows: [{ tenant, usage }],
    } = await db.query(
      `SELECT to_jsonb(tenant) AS tenant,
         (SELECT count(*)::int FROM message_jobs m
           JOIN templates t ON t.tenant_id=m.tenant_id AND t.id=m.template_id
          WHERE t.message_class='marketing'
            AND m.status IN ('dispatching','unknown','accepted','delivered')
            AND m.created_at>=date_trunc('month',$2::timestamptz AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS usage
         FROM tenants tenant WHERE tenant.id=$1`,
      [ctx.tenant, now],
    );
    if (tenant.status !== "active") r.push("TENANT_INACTIVE");
    if (usage >= tenant.ad_limit) r.push("QUOTA_EXCEEDED");
  }
  const decision = {
    id: randomUUID(),
    allowed: r.length === 0,
    reasons: [...new Set(r)],
    ruleset: RULESET,
    revision,
    evaluated_at: now.toISOString(),
  };
  await db.query(
    "INSERT INTO decisions(tenant_id,id,subject_id,allowed,reasons,ruleset,input,revision,evaluated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      ctx.tenant,
      decision.id,
      s.id,
      decision.allowed,
      decision.reasons,
      RULESET,
      JSON.stringify({
        ...i,
        message_hash: t.hash,
        connector_id: connector?.id,
        controller_id: t.controller_id,
      }),
      revision,
      now,
    ],
  );
  return decision;
}
export async function enqueue(
  db: DB,
  ctx: Context,
  input: unknown,
  now = new Date(),
) {
  permit(ctx, "messages:send");
  const i = sendInput
      .extend({
        idempotency_key: z.string().min(1).max(200),
        scheduled_at: z.iso.datetime().optional(),
      })
      .strict()
      .parse(input),
    payload = hash(JSON.stringify(i));
  const {
    rows: [old],
  } = await db.query("SELECT * FROM message_jobs WHERE idempotency_key=$1", [
    i.idempotency_key,
  ]);
  if (old) {
    if (old.payload_hash !== payload) fail("IDEMPOTENCY_CONFLICT", 409);
    return old;
  }
  const d = await evaluate(
    db,
    { ...ctx, role: "system" },
    {
      subject_id: i.subject_id,
      contact_id: i.contact_id,
      template_id: i.template_id,
    },
    new Date(i.scheduled_at ?? now),
  );
  const {
    rows: [job],
  } = await db.query(
    "INSERT INTO message_jobs(tenant_id,id,subject_id,contact_id,template_id,idempotency_key,payload_hash,status,scheduled_at,reasons,decision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
    [
      ctx.tenant,
      randomUUID(),
      i.subject_id,
      i.contact_id,
      i.template_id,
      i.idempotency_key,
      payload,
      d.allowed ? "queued" : "blocked",
      i.scheduled_at ?? now,
      d.reasons,
      d.id,
    ],
  );
  return job;
}
