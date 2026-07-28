-- Knowledge Platform schema migration
-- Migration id: 0031_source_connection_capability_provenance
-- Dialect: postgres
-- Integrated source connections persist only the admitted Capability grant locator. The bearer,
-- raw jti, Dify credential, and membership snapshot never cross this persistence boundary.

ALTER TABLE "source_connections"
  ADD COLUMN IF NOT EXISTS "capability_grant_id" UUID;

DO $kfs_source_connection_capability_grant_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'source_connections_capability_grant_fk'
      AND conrelid = 'source_connections'::regclass
  ) THEN
    ALTER TABLE "source_connections"
      ADD CONSTRAINT "source_connections_capability_grant_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id", "capability_grant_id")
      REFERENCES "capability_grants" ("tenant_id", "knowledge_space_id", "grant_id")
      ON DELETE RESTRICT;
  END IF;
END
$kfs_source_connection_capability_grant_fk$;

CREATE INDEX IF NOT EXISTS "source_connections_capability_grant_idx"
  ON "source_connections" ("tenant_id", "knowledge_space_id", "capability_grant_id");
