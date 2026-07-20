-- Knowledge Platform schema migration
-- Migration id: 0016_compilation_job_requester_binding
-- Dialect: postgres

-- Public compilation-job control is bound to the exact durable permission provenance. NULL across
-- the full binding denotes legacy/internal attempts, which public handlers treat as inaccessible.
ALTER TABLE "document_compilation_attempts"
  ADD COLUMN IF NOT EXISTS "requested_by_subject_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "permission_snapshot_id" UUID,
  ADD COLUMN IF NOT EXISTS "permission_snapshot_revision" INTEGER,
  ADD COLUMN IF NOT EXISTS "access_channel" VARCHAR(16);

-- The ledger marker is written after this artifact. Guard every incremental constraint so a
-- process exit after PostgreSQL commits DDL can safely replay the complete migration.
DO $kfs_0016_compilation_permission_binding_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'document_compilation_attempts_permission_binding_ck'
      AND "conrelid" = 'document_compilation_attempts'::regclass
  ) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_permission_binding_ck"
      CHECK (
        (
          "requested_by_subject_id" IS NULL
          AND "permission_snapshot_id" IS NULL
          AND "permission_snapshot_revision" IS NULL
          AND "access_channel" IS NULL
        )
        OR (
          "requested_by_subject_id" IS NOT NULL
          AND "permission_snapshot_id" IS NOT NULL
          AND "permission_snapshot_revision" >= 1
          AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
        )
      );
  END IF;
END
$kfs_0016_compilation_permission_binding_ck$;

DO $kfs_0016_compilation_permission_snapshot_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conname" = 'document_compilation_attempts_permission_snapshot_fk'
      AND "conrelid" = 'document_compilation_attempts'::regclass
  ) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_permission_snapshot_fk"
      FOREIGN KEY (
        "tenant_id",
        "knowledge_space_id",
        "permission_snapshot_id",
        "requested_by_subject_id",
        "access_channel"
      ) REFERENCES "knowledge_space_permission_snapshots" (
        "tenant_id",
        "knowledge_space_id",
        "id",
        "subject_id",
        "access_channel"
      ) ON DELETE RESTRICT;
  END IF;
END
$kfs_0016_compilation_permission_snapshot_fk$;
