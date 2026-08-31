-- Knowledge Platform schema migration
-- Migration id: 0047_parse_artifact_checkpoints
-- Dialect: postgres
-- Persists raw parser output across compilation retries without exposing it as canonical content.

CREATE TABLE IF NOT EXISTS "parse_artifact_checkpoints" (
  "document_asset_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "policy_fingerprint" VARCHAR(64) NOT NULL,
  "artifact" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "parse_artifact_checkpoints_asset_fk"
    FOREIGN KEY ("document_asset_id")
    REFERENCES "document_assets" ("id") ON DELETE CASCADE,
  CONSTRAINT "parse_artifact_checkpoints_version_ck"
    CHECK ("version" >= 1),
  CONSTRAINT "parse_artifact_checkpoints_policy_fingerprint_ck"
    CHECK ("policy_fingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "parse_artifact_checkpoints_artifact_ck"
    CHECK (jsonb_typeof("artifact") = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS "parse_artifact_checkpoints_asset_version_uq"
  ON "parse_artifact_checkpoints" ("document_asset_id", "version");
