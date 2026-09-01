-- Knowledge Platform schema migration
-- Migration id: 0048_deletion_active_scope_indexes
-- Dialect: postgres
-- Keeps active deletion admission proportional to live fences instead of permanent audit history.

CREATE INDEX IF NOT EXISTS "deletion_jobs_active_scope_idx"
  ON "deletion_jobs" ("tenant_id", "knowledge_space_id", "target_type", "target_id")
  WHERE "active_slot" = 1;

CREATE INDEX IF NOT EXISTS "deletion_tombstones_active_scope_idx"
  ON "deletion_tombstones" ("tenant_id", "knowledge_space_id")
  WHERE "state" = 'active';
