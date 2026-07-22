-- Knowledge Platform schema migration
-- Migration id: 0025_capability_grant_provenance
-- Dialect: postgres
-- New tables are replay-safe and never persist a Capability bearer token or raw jti.

CREATE TABLE IF NOT EXISTS "capability_grants" (
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "grant_id" UUID NOT NULL,
  "claims_digest" VARCHAR(71) NOT NULL,
  "subject_id" VARCHAR(255) NOT NULL,
  "actor_id" VARCHAR(255) NOT NULL,
  "caller_kind" VARCHAR(32) NOT NULL,
  "action" VARCHAR(128) NOT NULL,
  "resource_type" VARCHAR(64) NOT NULL,
  "resource_id" VARCHAR(255) NOT NULL,
  "resource_parent_id" VARCHAR(255),
  "jti_hash" VARCHAR(71) NOT NULL,
  "trace_id" VARCHAR(255) NOT NULL,
  "authz_revision" JSONB NOT NULL,
  "content_scope_ids" JSONB NOT NULL,
  "content_policy_revision" INTEGER NOT NULL,
  "issued_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "highest_revoke_sequence" BIGINT NOT NULL,
  "revoke_reason_code" VARCHAR(64),
  "revoked_at" TIMESTAMPTZ,
  "revision" INTEGER NOT NULL,
  "admitted_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "capability_grants_state_ck" CHECK (
    "revision" >= 1 AND "highest_revoke_sequence" >= 0
    AND "state" IN ('active', 'revoked')
    AND (("state" = 'active' AND "revoked_at" IS NULL AND "revoke_reason_code" IS NULL)
      OR ("state" = 'revoked' AND "revoked_at" IS NOT NULL
        AND "revoke_reason_code" IS NOT NULL))
  ),
  CONSTRAINT "capability_grants_digest_ck" CHECK (
    "claims_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "jti_hash" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "capability_grants_json_ck" CHECK (
    jsonb_typeof("authz_revision") = 'object'
    AND jsonb_typeof("content_scope_ids") = 'array'
  ),
  PRIMARY KEY ("tenant_id", "knowledge_space_id", "grant_id"),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "capability_space_fences" (
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "tombstoned" BOOLEAN NOT NULL,
  "highest_revoke_sequence" BIGINT NOT NULL,
  "reason_code" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "capability_space_fences_revision_ck" CHECK (
    "revision" >= 1 AND "highest_revoke_sequence" >= 1
  ),
  PRIMARY KEY ("tenant_id", "knowledge_space_id"),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "capability_revoke_receipts" (
  "event_id" VARCHAR(255) PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "target_kind" VARCHAR(16) NOT NULL,
  "grant_id" UUID,
  "revoke_sequence" BIGINT NOT NULL,
  "reason_code" VARCHAR(64) NOT NULL,
  "tombstoned" BOOLEAN,
  "applied" BOOLEAN NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "capability_revoke_receipts_target_ck" CHECK (
    "revoke_sequence" >= 1
    AND (("target_kind" = 'grant' AND "grant_id" IS NOT NULL AND "tombstoned" IS NULL)
      OR ("target_kind" = 'space' AND "grant_id" IS NULL AND "tombstoned" IS NOT NULL))
  ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "capability_grants_jti_hash_uq"
  ON "capability_grants" ("jti_hash");
CREATE INDEX IF NOT EXISTS "capability_grants_subject_audit_idx"
  ON "capability_grants" (
    "tenant_id", "knowledge_space_id", "subject_id", "admitted_at", "grant_id"
  );
CREATE INDEX IF NOT EXISTS "capability_revoke_receipts_scope_sequence_idx"
  ON "capability_revoke_receipts" (
    "tenant_id", "knowledge_space_id", "revoke_sequence", "received_at"
  );
