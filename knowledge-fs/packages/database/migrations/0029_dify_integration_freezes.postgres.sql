-- Knowledge Platform schema migration
-- Migration id: 0029_dify_integration_freezes
-- Dialect: postgres
-- A durable per-Workspace maintenance freeze stops legacy writes before final delta.

CREATE TABLE IF NOT EXISTS "dify_integration_freezes" (
  "tenant_id" VARCHAR(255) PRIMARY KEY NOT NULL,
  "freeze_id" VARCHAR(255) NOT NULL,
  "freeze_revision" BIGINT NOT NULL,
  "source_revision_digest" VARCHAR(71) NOT NULL,
  "source_task_watermark" BIGINT NOT NULL,
  "frozen_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "dify_integration_freezes_evidence_ck" CHECK (
    "freeze_revision" >= 1
    AND "source_task_watermark" >= 0
    AND "source_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
  )
);
