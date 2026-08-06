-- Knowledge Platform schema migration
-- Migration id: 0037_logical_document_zero_revision_deletion
-- Dialect: postgres

-- A logical document starts at row_version 0 and can fail before its first revision is activated.
-- Durable deletion already accepts that CAS value; keep other target revisions strictly positive.
ALTER TABLE "deletion_jobs"
  DROP CONSTRAINT IF EXISTS "deletion_jobs_positive_ck";
ALTER TABLE "deletion_jobs"
  ADD CONSTRAINT "deletion_jobs_positive_ck" CHECK (
    (
      ("target_type" = 'logical_document' AND "target_revision" >= 0)
      OR ("target_type" <> 'logical_document' AND "target_revision" >= 1)
    )
    AND ("capability_grant_id" IS NOT NULL OR "permission_snapshot_revision" >= 1)
    AND "row_version" >= 1
    AND "execution_attempts" >= 0
    AND "max_execution_attempts" >= 1
    AND "execution_attempts" <= "max_execution_attempts"
    AND ("active_slot" IS NULL OR "active_slot" = 1)
  );

ALTER TABLE "deletion_tombstones"
  DROP CONSTRAINT IF EXISTS "deletion_tombstones_positive_ck";
ALTER TABLE "deletion_tombstones"
  ADD CONSTRAINT "deletion_tombstones_positive_ck" CHECK (
    (
      ("target_type" = 'logical_document' AND "target_revision" >= 0)
      OR ("target_type" <> 'logical_document' AND "target_revision" >= 1)
    )
    AND "row_version" >= 1
  );
