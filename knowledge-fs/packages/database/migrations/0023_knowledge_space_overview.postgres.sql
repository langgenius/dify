-- Knowledge Platform schema migration
-- Migration id: 0023_knowledge_space_overview
-- Dialect: postgres

ALTER TABLE "knowledge_spaces" ADD COLUMN IF NOT EXISTS "icon_ref" VARCHAR(72);
DO $kfs_space_icon_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_spaces_icon_ref_ck'
      AND conrelid = 'knowledge_spaces'::regclass
  ) THEN
    ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_icon_ref_ck"
      CHECK (
        "icon_ref" IS NULL
        OR "icon_ref" ~ '^builtin:[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
      );
  END IF;
END
$kfs_space_icon_check$;

CREATE TABLE IF NOT EXISTS "knowledge_space_activity_events" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "actor_type" VARCHAR(16) NOT NULL,
  "actor_subject_id" VARCHAR(255),
  "action" VARCHAR(64) NOT NULL,
  "resource_type" VARCHAR(32) NOT NULL,
  "resource_id" VARCHAR(255),
  "result" VARCHAR(16) NOT NULL,
  "required_permission_scope" JSONB NOT NULL,
  "details" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_activity_actor_ck" CHECK (
    ("actor_type" = 'member' AND "actor_subject_id" IS NOT NULL)
    OR ("actor_type" = 'system' AND "actor_subject_id" IS NULL)
  ),
  CONSTRAINT "knowledge_space_activity_action_ck" CHECK (
    "action" IN (
      'query.requested', 'query.completed', 'query.failed',
      'document.published', 'document.failed',
      'source.synced', 'source.failed',
      'settings.updated', 'permission.updated', 'profile.published', 'worker.failed'
    )
  ),
  CONSTRAINT "knowledge_space_activity_resource_ck" CHECK (
    "resource_type" IN (
      'knowledge-space', 'query', 'document', 'source', 'permission',
      'profile', 'publication', 'worker'
    )
  ),
  CONSTRAINT "knowledge_space_activity_result_ck"
    CHECK ("result" IN ('pending', 'success', 'failure', 'canceled')),
  CONSTRAINT "knowledge_space_activity_scope_json_ck"
    CHECK (jsonb_typeof("required_permission_scope") = 'array'),
  CONSTRAINT "knowledge_space_activity_details_json_ck"
    CHECK (jsonb_typeof("details") = 'object'),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_activity_scope_id_uq"
  ON "knowledge_space_activity_events" ("tenant_id", "knowledge_space_id", "id");
CREATE INDEX IF NOT EXISTS "knowledge_space_activity_feed_idx"
  ON "knowledge_space_activity_events" (
    "tenant_id", "knowledge_space_id", "occurred_at" DESC, "id" DESC
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_activity_stats_idx"
  ON "knowledge_space_activity_events" (
    "tenant_id", "knowledge_space_id", "action", "occurred_at"
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_activity_scope_gin_idx"
  ON "knowledge_space_activity_events" USING GIN ("required_permission_scope");

CREATE TABLE IF NOT EXISTS "knowledge_space_attention_states" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "issue_key" VARCHAR(255) NOT NULL,
  "rule_id" VARCHAR(64) NOT NULL,
  "resource_type" VARCHAR(32) NOT NULL,
  "resource_id" VARCHAR(255) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "dismissed_until" TIMESTAMPTZ,
  "revision" INTEGER NOT NULL,
  "updated_by_subject_id" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_attention_rule_ck" CHECK (
    "rule_id" IN (
      'stale-source', 'failed-document', 'low-quality-query',
      'permission-readiness', 'model-readiness'
    )
  ),
  CONSTRAINT "knowledge_space_attention_resource_ck" CHECK (
    "resource_type" IN ('knowledge-space', 'document', 'source', 'failed-query')
  ),
  CONSTRAINT "knowledge_space_attention_status_ck"
    CHECK ("status" IN ('active', 'dismissed', 'resolved')),
  CONSTRAINT "knowledge_space_attention_dismiss_ck" CHECK (
    ("status" = 'dismissed' AND "dismissed_until" IS NOT NULL)
    OR ("status" <> 'dismissed' AND "dismissed_until" IS NULL)
  ),
  CONSTRAINT "knowledge_space_attention_revision_ck" CHECK ("revision" >= 1),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_attention_issue_uq"
  ON "knowledge_space_attention_states" (
    "tenant_id", "knowledge_space_id", "issue_key"
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_attention_list_idx"
  ON "knowledge_space_attention_states" (
    "tenant_id", "knowledge_space_id", "status", "updated_at" DESC, "id"
  );
