CREATE TABLE retention_policies(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),days integer NOT NULL CHECK(days>=0 AND days<=36500),basis text NOT NULL,approved_by text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE holds(tenant_id uuid,id uuid NOT NULL,subject_id uuid NOT NULL,basis text NOT NULL,until_at timestamptz NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,subject_id) REFERENCES subjects(tenant_id,id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['retention_policies','holds'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t); END LOOP; END $$;
CREATE OR REPLACE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND current_user<>session_user AND current_setting('app.retention_delete',true)='approved' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'immutable record: append a correction'; END $$;
CREATE FUNCTION purge_retained_subject(p_tenant uuid,p_subject uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE policy_days integer;
BEGIN
 IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant boundary'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text,0));
 SELECT days INTO policy_days FROM retention_policies WHERE tenant_id=p_tenant;
 IF policy_days IS NULL THEN RAISE EXCEPTION 'approved retention policy required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM subjects WHERE tenant_id=p_tenant AND id=p_subject AND restricted AND deleted_at IS NOT NULL AND deleted_at<=now()-make_interval(days=>policy_days)) THEN RAISE EXCEPTION 'retention period has not ended'; END IF;
 IF EXISTS(SELECT 1 FROM holds WHERE tenant_id=p_tenant AND subject_id=p_subject AND until_at>now()) THEN RAISE EXCEPTION 'legal hold active'; END IF;
 IF EXISTS(SELECT 1 FROM deletion_requests WHERE tenant_id=p_tenant AND subject_id=p_subject AND status<>'completed') THEN RAISE EXCEPTION 'external deletion unconfirmed'; END IF;
 PERFORM set_config('app.retention_delete','approved',true);
 DELETE FROM notification_jobs WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM provider_receipts WHERE tenant_id=p_tenant AND job_id IN(SELECT id FROM message_jobs WHERE tenant_id=p_tenant AND subject_id=p_subject);
 DELETE FROM message_jobs WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM decisions WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM outbox WHERE tenant_id=p_tenant AND event_id IN(SELECT id FROM consent_events WHERE tenant_id=p_tenant AND subject_id=p_subject);
 DELETE FROM consent_current WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM suppressions WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM consent_events WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM agreement_events WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM identity_links WHERE tenant_id=p_tenant AND (member_id=p_subject OR browser_id=p_subject);
 DELETE FROM deletion_tasks WHERE tenant_id=p_tenant AND request_id IN(SELECT id FROM deletion_requests WHERE tenant_id=p_tenant AND subject_id=p_subject);
 DELETE FROM deletion_requests WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM holds WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM contact_points WHERE tenant_id=p_tenant AND subject_id=p_subject;
 DELETE FROM subjects WHERE tenant_id=p_tenant AND id=p_subject;
 PERFORM set_config('app.retention_delete','',true);
END $$;
REVOKE ALL ON FUNCTION purge_retained_subject(uuid,uuid) FROM PUBLIC;
