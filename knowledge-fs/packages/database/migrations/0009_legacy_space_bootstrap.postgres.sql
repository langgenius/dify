-- Knowledge Platform schema migration
-- Migration id: 0009_legacy_space_bootstrap
-- Dialect: postgres

-- Legacy NULL-generation artifacts cannot be adopted safely: historical Graph entities may span
-- documents and therefore do not have a recoverable single-document owner. A bootstrap instead
-- rebuilds the frozen document snapshot through the durable generation writer. The job row is
-- also the query-readiness latch: strict readers remain unavailable until run_state=succeeded.
CREATE TABLE IF NOT EXISTS "legacy_space_publication_bootstraps" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "checkpoint" VARCHAR(32) NOT NULL,
  "run_state" VARCHAR(16) NOT NULL,
  "total_documents" INTEGER NOT NULL,
  "completed_documents" INTEGER NOT NULL,
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "row_version" INTEGER NOT NULL,
  "published_publication_id" UUID,
  "published_fingerprint" VARCHAR(86),
  "published_head_revision" INTEGER,
  "snapshot_metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "legacy_space_bootstraps_checkpoint_ck"
    CHECK (
      "checkpoint" IN (
        'pending_snapshot',
        'snapshot_captured',
        'rebuilding',
        'verifying',
        'published'
      )
    ),
  CONSTRAINT "legacy_space_bootstraps_run_state_ck"
    CHECK ("run_state" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT "legacy_space_bootstraps_counts_ck"
    CHECK (
      "total_documents" >= 0
      AND "completed_documents" >= 0
      AND "completed_documents" <= "total_documents"
    ),
  CONSTRAINT "legacy_space_bootstraps_row_version_ck" CHECK ("row_version" >= 0),
  CONSTRAINT "legacy_space_bootstraps_lease_state_ck"
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
  CONSTRAINT "legacy_space_bootstraps_terminal_ck"
    CHECK (
      ("run_state" IN ('succeeded', 'failed', 'canceled') AND "completed_at" IS NOT NULL)
      OR ("run_state" IN ('queued', 'running') AND "completed_at" IS NULL)
    ),
  CONSTRAINT "legacy_space_bootstraps_publication_ck"
    CHECK (
      (
        "run_state" = 'succeeded'
        AND "checkpoint" = 'published'
        AND "completed_documents" = "total_documents"
        AND (
          "total_documents" = 0
          OR (
            "published_publication_id" IS NOT NULL
            AND "published_fingerprint" IS NOT NULL
            AND "published_head_revision" IS NOT NULL
            AND "published_head_revision" > 0
          )
        )
      )
      OR "run_state" <> 'succeeded'
    ),
  CONSTRAINT "legacy_space_bootstraps_lease_token_ck"
    CHECK (
      "lease_token" IS NULL
      OR "lease_token" <> '00000000-0000-0000-0000-000000000000'::uuid
    ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id")
    ON DELETE CASCADE,
  FOREIGN KEY (
    "tenant_id",
    "knowledge_space_id",
    "published_publication_id",
    "published_fingerprint"
  )
    REFERENCES "projection_set_publications" (
      "tenant_id",
      "knowledge_space_id",
      "id",
      "fingerprint"
    )
    ON DELETE RESTRICT
);

-- One immutable migration ledger exists per tenant-scoped space. A failed job is retried in place,
-- so operators cannot accidentally create a second snapshot with different membership.
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_space_bootstraps_space_uq"
  ON "legacy_space_publication_bootstraps" ("tenant_id", "knowledge_space_id");
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_space_bootstraps_idempotency_uq"
  ON "legacy_space_publication_bootstraps" (
    "tenant_id",
    "knowledge_space_id",
    "idempotency_key"
  );
CREATE INDEX IF NOT EXISTS "legacy_space_bootstraps_claim_idx"
  ON "legacy_space_publication_bootstraps" (
    "run_state",
    "lease_expires_at",
    "updated_at",
    "id"
  );

-- Items freeze the complete document/version/hash set before any generation build is admitted.
-- compilation_attempt_id is intentionally an audit reference rather than an FK: normal retention
-- may delete terminal compilation attempts without weakening the bootstrap ledger.
CREATE TABLE IF NOT EXISTS "legacy_space_publication_bootstrap_items" (
  "bootstrap_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "document_sha256" VARCHAR(64) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "compilation_attempt_id" UUID,
  "status" VARCHAR(16) NOT NULL,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("bootstrap_id", "document_asset_id"),
  CONSTRAINT "legacy_space_bootstrap_items_version_ck" CHECK ("document_version" > 0),
  CONSTRAINT "legacy_space_bootstrap_items_ordinal_ck" CHECK ("ordinal" >= 0),
  CONSTRAINT "legacy_space_bootstrap_items_status_ck"
    CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed')),
  FOREIGN KEY ("bootstrap_id")
    REFERENCES "legacy_space_publication_bootstraps" ("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "legacy_space_bootstrap_items_ordinal_uq"
  ON "legacy_space_publication_bootstrap_items" ("bootstrap_id", "ordinal");
CREATE INDEX IF NOT EXISTS "legacy_space_bootstrap_items_next_idx"
  ON "legacy_space_publication_bootstrap_items" (
    "bootstrap_id",
    "status",
    "ordinal",
    "document_asset_id"
  );
CREATE INDEX IF NOT EXISTS "legacy_space_bootstrap_items_attempt_idx"
  ON "legacy_space_publication_bootstrap_items" (
    "compilation_attempt_id",
    "bootstrap_id",
    "document_asset_id"
  );

-- A document mutation holds this durable, space-exclusive lease from admission through its final
-- metadata write. Bootstrap snapshot capture takes the same knowledge_spaces row lock and refuses
-- to run while a lease exists, closing the check-then-write race. Leases never expire implicitly:
-- a crashed writer fails closed until an operator proves it stopped and removes the orphan.
CREATE TABLE IF NOT EXISTS "knowledge_space_mutation_leases" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "acquired_at" TIMESTAMPTZ NOT NULL,
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id")
    ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_mutation_leases_space_uq"
  ON "knowledge_space_mutation_leases" ("tenant_id", "knowledge_space_id");

-- Install the fail-closed latch in the same migration that introduces strict published reads.
-- The marker deliberately does not copy the document set inside this DDL transaction. The bounded
-- bootstrap runtime freezes that set under the stable space-row lock before admitting any build.
-- knowledge_space_id is already a tenant-owned UUID and is safe as the one-time ledger id.
INSERT INTO "legacy_space_publication_bootstraps" (
  "id",
  "tenant_id",
  "knowledge_space_id",
  "idempotency_key",
  "checkpoint",
  "run_state",
  "total_documents",
  "completed_documents",
  "row_version",
  "snapshot_metadata",
  "created_at",
  "updated_at"
)
SELECT
  ks."id",
  ks."tenant_id",
  ks."id",
  'legacy-space-publication-bootstrap-v1',
  'pending_snapshot',
  'queued',
  0,
  0,
  0,
  '{"schemaVersion":1,"strategy":"full-generation-rebuild","source":"migration-marker"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "knowledge_spaces" ks
WHERE NOT EXISTS (
  SELECT 1
  FROM "projection_set_publication_heads" head
  WHERE head."tenant_id" = ks."tenant_id"
    AND head."knowledge_space_id" = ks."id"
)
AND (
  EXISTS (
    SELECT 1 FROM "document_assets" asset
    WHERE asset."knowledge_space_id" = ks."id"
  )
  OR EXISTS (
    SELECT 1 FROM "knowledge_nodes" node
    WHERE node."knowledge_space_id" = ks."id"
      AND node."publication_generation_id" IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM "index_projections" projection
    WHERE projection."knowledge_space_id" = ks."id"
      AND projection."publication_generation_id" IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM "document_outlines" outline
    WHERE outline."knowledge_space_id" = ks."id"
      AND outline."publication_generation_id" IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM "document_multimodal_manifests" manifest
    WHERE manifest."knowledge_space_id" = ks."id"
      AND manifest."publication_generation_id" IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM "knowledge_paths" path
    WHERE path."knowledge_space_id" = ks."id"
      AND path."publication_generation_id" IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM "graph_entities" entity
    WHERE entity."knowledge_space_id" = ks."id"
      AND entity."publication_generation_id" IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM "graph_relations" relation
    WHERE relation."knowledge_space_id" = ks."id"
      AND relation."publication_generation_id" IS NULL
  )
)
ON CONFLICT ("tenant_id", "knowledge_space_id") DO NOTHING;
