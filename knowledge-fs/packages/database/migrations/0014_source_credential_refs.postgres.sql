-- Knowledge Platform schema migration
-- Migration id: 0014_source_credential_refs
-- Dialect: postgres

-- Source rows retain only an opaque reference. Secret bytes live in the configured SecretStore;
-- legacy metadata.credentials values are moved by a fenced, restart-safe application worker.
ALTER TABLE "sources"
  ADD COLUMN IF NOT EXISTS "credential_ref" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "sources_credential_ref_uq"
  ON "sources" ("credential_ref")
  WHERE "credential_ref" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "sources_credential_backfill_discovery_idx"
  ON "sources" ("id")
  WHERE "credential_ref" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sources_space_id_uq"
  ON "sources" ("knowledge_space_id", "id");

CREATE TABLE IF NOT EXISTS "source_credential_backfills" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "source_version" INTEGER NOT NULL,
  "candidate_credential_ref" TEXT NOT NULL,
  "secret_fingerprint" CHAR(64) NOT NULL,
  "run_state" TEXT NOT NULL,
  "worker_id" TEXT,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "retry_count" INTEGER NOT NULL,
  "row_version" INTEGER NOT NULL,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "source_credential_backfills_source_version_ck"
    CHECK ("source_version" >= 1),
  CONSTRAINT "source_credential_backfills_counts_ck"
    CHECK ("retry_count" >= 0 AND "row_version" >= 0),
  CONSTRAINT "source_credential_backfills_state_ck"
    CHECK ("run_state" IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT "source_credential_backfills_lease_ck"
    CHECK (
      (
        "run_state" = 'running'
        AND "worker_id" IS NOT NULL
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "heartbeat_at" IS NOT NULL
        AND "completed_at" IS NULL
      )
      OR (
        "run_state" <> 'running'
        AND "worker_id" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "heartbeat_at" IS NULL
      )
    ),
  CONSTRAINT "source_credential_backfills_terminal_ck"
    CHECK (
      ("run_state" IN ('succeeded', 'failed') AND "completed_at" IS NOT NULL)
      OR ("run_state" IN ('queued', 'running') AND "completed_at" IS NULL)
    ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("knowledge_space_id", "source_id")
    REFERENCES "sources" ("knowledge_space_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "source_credential_backfills_source_uq"
  ON "source_credential_backfills" ("tenant_id", "knowledge_space_id", "source_id");
CREATE UNIQUE INDEX IF NOT EXISTS "source_credential_backfills_candidate_ref_uq"
  ON "source_credential_backfills" ("candidate_credential_ref");
CREATE INDEX IF NOT EXISTS "source_credential_backfills_claim_idx"
  ON "source_credential_backfills" ("run_state", "lease_expires_at", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "source_credential_backfills_scope_idx"
  ON "source_credential_backfills" ("tenant_id", "knowledge_space_id", "source_id", "id");

-- This ledger intentionally has no FK to sources/spaces: credential erasure must survive resource
-- deletion long enough for the cleanup worker to remove encrypted bytes from SecretStore.
CREATE TABLE IF NOT EXISTS "source_secret_lifecycle_refs" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "credential_ref" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "source_version" INTEGER,
  "recover_after" TIMESTAMPTZ NOT NULL,
  "next_delete_at" TIMESTAMPTZ,
  "worker_id" TEXT,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "delete_attempts" INTEGER NOT NULL,
  "row_version" INTEGER NOT NULL,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "source_secret_lifecycle_refs_source_version_ck"
    CHECK ("source_version" IS NULL OR "source_version" >= 1),
  CONSTRAINT "source_secret_lifecycle_refs_purpose_ck"
    CHECK ("purpose" IN ('create', 'rotate', 'backfill')),
  CONSTRAINT "source_secret_lifecycle_refs_counts_ck"
    CHECK ("delete_attempts" >= 0 AND "row_version" >= 0),
  CONSTRAINT "source_secret_lifecycle_refs_state_ck"
    CHECK ("state" IN ('staged', 'candidate', 'active', 'retired', 'deleting', 'deleted')),
  CONSTRAINT "source_secret_lifecycle_refs_lease_ck"
    CHECK (
      (
        "state" = 'deleting'
        AND "worker_id" IS NOT NULL
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "heartbeat_at" IS NOT NULL
        AND "deleted_at" IS NULL
      )
      OR (
        "state" <> 'deleting'
        AND "worker_id" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "heartbeat_at" IS NULL
      )
    ),
  CONSTRAINT "source_secret_lifecycle_refs_terminal_ck"
    CHECK (
      ("state" = 'deleted' AND "deleted_at" IS NOT NULL)
      OR ("state" <> 'deleted' AND "deleted_at" IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "source_secret_lifecycle_refs_ref_uq"
  ON "source_secret_lifecycle_refs" ("credential_ref");
CREATE INDEX IF NOT EXISTS "source_secret_lifecycle_refs_operation_idx"
  ON "source_secret_lifecycle_refs" ("operation_id", "state", "id");
CREATE INDEX IF NOT EXISTS "source_secret_lifecycle_refs_claim_idx"
  ON "source_secret_lifecycle_refs"
    ("state", "next_delete_at", "lease_expires_at", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "source_secret_lifecycle_refs_recovery_idx"
  ON "source_secret_lifecycle_refs" ("state", "recover_after", "id");
CREATE INDEX IF NOT EXISTS "source_secret_lifecycle_refs_scope_idx"
  ON "source_secret_lifecycle_refs" ("tenant_id", "knowledge_space_id", "source_id", "id");

-- Rolling upgrades may replay this migration after credential refs were already written. Register
-- those refs as active before application traffic can rotate/revoke them; source ids are stable UUIDs
-- and are safe deterministic lifecycle ids in this table's independent keyspace.
INSERT INTO "source_secret_lifecycle_refs" (
  "id", "tenant_id", "knowledge_space_id", "source_id", "credential_ref", "operation_id",
  "purpose", "state", "source_version", "recover_after", "delete_attempts", "row_version",
  "created_at", "updated_at"
)
SELECT
  src."id", space."tenant_id", src."knowledge_space_id", src."id", src."credential_ref",
  'legacy-source:' || src."id"::TEXT || ':' || src."version"::TEXT,
  'rotate', 'active', src."version", src."updated_at", 0, 0, src."updated_at", src."updated_at"
FROM "sources" src
INNER JOIN "knowledge_spaces" space ON space."id" = src."knowledge_space_id"
WHERE src."credential_ref" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ON CONFLICT makes crash replay safe, but it must never hide a ref/id collision or a partial
-- rolling-upgrade registry. Verify both directions and abort before this migration is recorded.
DO $kfs_source_secret_lifecycle_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sources" src
    INNER JOIN "knowledge_spaces" space ON space."id" = src."knowledge_space_id"
    LEFT JOIN "source_secret_lifecycle_refs" lifecycle
      ON lifecycle."credential_ref" = src."credential_ref"
    WHERE src."credential_ref" IS NOT NULL
      AND (
        lifecycle."id" IS NULL
        OR lifecycle."state" <> 'active'
        OR lifecycle."tenant_id" <> space."tenant_id"
        OR lifecycle."knowledge_space_id" <> src."knowledge_space_id"
        OR lifecycle."source_id" <> src."id"
      )
  ) THEN
    RAISE EXCEPTION
      'source credential_ref is missing a matching active lifecycle registry row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "source_secret_lifecycle_refs" lifecycle
    LEFT JOIN "sources" src
      ON src."id" = lifecycle."source_id"
      AND src."knowledge_space_id" = lifecycle."knowledge_space_id"
    LEFT JOIN "knowledge_spaces" space
      ON space."id" = lifecycle."knowledge_space_id"
    WHERE lifecycle."state" = 'active'
      AND (
        src."id" IS NULL
        OR src."credential_ref" IS DISTINCT FROM lifecycle."credential_ref"
        OR space."id" IS NULL
        OR space."tenant_id" IS DISTINCT FROM lifecycle."tenant_id"
      )
  ) THEN
    RAISE EXCEPTION
      'active source secret lifecycle row is orphaned or does not match its source';
  END IF;
END
$kfs_source_secret_lifecycle_guard$;
