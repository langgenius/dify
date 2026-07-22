-- Knowledge Platform schema migration
-- Migration id: 0028_dify_integration_states
-- Dialect: postgres
-- One-way, tenant-scoped activation prevents mixed authorization sources inside a Workspace.

CREATE TABLE IF NOT EXISTS "dify_integration_states" (
  "tenant_id" VARCHAR(255) PRIMARY KEY NOT NULL,
  "activation_id" VARCHAR(255) NOT NULL,
  "activation_revision" BIGINT NOT NULL,
  "source_revision_digest" VARCHAR(71) NOT NULL,
  "activated_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "dify_integration_states_evidence_ck" CHECK (
    "activation_revision" >= 1
    AND "source_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
  )
);
