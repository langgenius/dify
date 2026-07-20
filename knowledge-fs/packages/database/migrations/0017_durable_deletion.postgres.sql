-- Knowledge Platform schema migration
-- Migration id: 0017_durable_deletion
-- Dialect: postgres

-- Resource rows remain present while deletion is in progress. Defaults preserve rolling-upgrade
-- compatibility for old writers; the application only enables the deletion endpoint after all
-- writers understand these fences.
ALTER TABLE "knowledge_spaces"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "lifecycle_state" VARCHAR(16) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "deletion_job_id" UUID,
  ADD COLUMN IF NOT EXISTS "deleting_at" TIMESTAMPTZ;

ALTER TABLE "sources"
  ADD COLUMN IF NOT EXISTS "deletion_job_id" UUID,
  ADD COLUMN IF NOT EXISTS "deleting_at" TIMESTAMPTZ;

ALTER TABLE "document_assets"
  ADD COLUMN IF NOT EXISTS "lifecycle_state" VARCHAR(16) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "deletion_job_id" UUID,
  ADD COLUMN IF NOT EXISTS "deleting_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "row_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "knowledge_space_mutation_leases"
  ADD COLUMN IF NOT EXISTS "lease_token" UUID,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ;
-- Rows created by the pre-0017 ownerless lease protocol are made immediately reclaimable. A live
-- writer remains fenced by the resource tombstone even if it returns after this compatibility cut.
UPDATE "knowledge_space_mutation_leases"
SET "lease_token" = "id",
    "heartbeat_at" = "acquired_at",
    "expires_at" = "acquired_at"
WHERE "lease_token" IS NULL OR "heartbeat_at" IS NULL OR "expires_at" IS NULL;

-- The catalog models manifests as tenant-owned rows. The original schema constrained only the
-- UUID, so fail closed on historical cross-tenant rows before installing the composite invariant.
-- Add the stronger FK before removing the legacy one so marker-loss replay never leaves a gap.
DO $kfs_0017_knowledge_space_manifests_space_fk$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "knowledge_space_manifests" AS manifest
    LEFT JOIN "knowledge_spaces" AS space
      ON space."tenant_id" = manifest."tenant_id"
     AND space."id" = manifest."knowledge_space_id"
    WHERE space."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'knowledge_space_manifests contains a tenant/space ownership mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = 'knowledge_space_manifests'::regclass
      AND "conname" = 'knowledge_space_manifests_space_fk'
  ) THEN
    ALTER TABLE "knowledge_space_manifests"
      ADD CONSTRAINT "knowledge_space_manifests_space_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id")
      REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE;
  END IF;

  ALTER TABLE "knowledge_space_manifests"
    DROP CONSTRAINT IF EXISTS "knowledge_space_manifests_knowledge_space_id_fkey";
END
$kfs_0017_knowledge_space_manifests_space_fk$;

-- Evidence bundles were originally ownerless. Keep the columns nullable for a rolling writer
-- upgrade, backfill only when every durable reference agrees on one tenant/space, and quarantine
-- ambiguous rows by leaving them NULL. Application reads fail closed and rollout readiness
-- requires the NULL population to be purged before durable deletion is enabled.
ALTER TABLE "evidence_bundles"
  ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "knowledge_space_id" UUID;

WITH evidence_scope_candidates AS (
  SELECT evidence."id" AS bundle_id,
         space."tenant_id" AS tenant_id,
         trace."knowledge_space_id" AS knowledge_space_id
  FROM "evidence_bundles" AS evidence
  INNER JOIN "answer_traces" AS trace
    ON trace."evidence_bundle_id" = evidence."id" OR trace."id" = evidence."trace_id"
  INNER JOIN "knowledge_spaces" AS space
    ON space."id" = trace."knowledge_space_id"
  UNION ALL
  SELECT evidence."id" AS bundle_id,
         partial."tenant_id" AS tenant_id,
         partial."knowledge_space_id" AS knowledge_space_id
  FROM "evidence_bundles" AS evidence
  INNER JOIN "research_task_partial_results" AS partial
    ON CASE
         WHEN jsonb_typeof(partial."evidence_bundle") = 'object'
           THEN partial."evidence_bundle" ->> 'id'
         ELSE NULL
       END = CAST(evidence."id" AS TEXT)
  INNER JOIN "knowledge_spaces" AS space
    ON space."tenant_id" = partial."tenant_id"
   AND space."id" = partial."knowledge_space_id"
), distinct_candidate_scopes AS (
  SELECT DISTINCT bundle_id, tenant_id, knowledge_space_id
  FROM evidence_scope_candidates
), unambiguous_evidence_scopes AS (
  SELECT bundle_id,
         MIN(tenant_id) AS tenant_id,
         MIN(CAST(knowledge_space_id AS TEXT))::UUID AS knowledge_space_id
  FROM distinct_candidate_scopes
  GROUP BY bundle_id
  HAVING COUNT(*) = 1
)
UPDATE "evidence_bundles" AS evidence
SET "tenant_id" = resolved."tenant_id",
    "knowledge_space_id" = resolved."knowledge_space_id"
FROM unambiguous_evidence_scopes AS resolved
WHERE evidence."id" = resolved.bundle_id
  AND evidence."tenant_id" IS NULL
  AND evidence."knowledge_space_id" IS NULL;

DO $kfs_0017_evidence_bundles_scope_pair_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = 'evidence_bundles'::regclass
      AND "conname" = 'evidence_bundles_scope_pair_ck'
  ) THEN
    ALTER TABLE "evidence_bundles"
      ADD CONSTRAINT "evidence_bundles_scope_pair_ck" CHECK (
        ("tenant_id" IS NULL AND "knowledge_space_id" IS NULL)
        OR ("tenant_id" IS NOT NULL AND "knowledge_space_id" IS NOT NULL)
      );
  END IF;
END
$kfs_0017_evidence_bundles_scope_pair_ck$;

DO $kfs_0017_evidence_bundles_scope_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = 'evidence_bundles'::regclass
      AND "conname" = 'evidence_bundles_scope_fk'
  ) THEN
    ALTER TABLE "evidence_bundles"
      ADD CONSTRAINT "evidence_bundles_scope_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id")
      REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE;
  END IF;
END
$kfs_0017_evidence_bundles_scope_fk$;

CREATE INDEX IF NOT EXISTS "evidence_bundles_scope_created_idx"
  ON "evidence_bundles" ("tenant_id", "knowledge_space_id", "created_at", "id");

DO $kfs_0017_knowledge_spaces_deletion_lifecycle_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = 'knowledge_spaces'::regclass
      AND "conname" = 'knowledge_spaces_deletion_lifecycle_ck'
  ) THEN
    ALTER TABLE "knowledge_spaces"
      ADD CONSTRAINT "knowledge_spaces_deletion_lifecycle_ck" CHECK (
        "revision" >= 1
        AND (
          ("lifecycle_state" = 'active' AND "deletion_job_id" IS NULL AND "deleting_at" IS NULL)
          OR
          ("lifecycle_state" = 'deleting' AND "deletion_job_id" IS NOT NULL AND "deleting_at" IS NOT NULL)
        )
      );
  END IF;
END
$kfs_0017_knowledge_spaces_deletion_lifecycle_ck$;

DO $kfs_0017_sources_deletion_lifecycle_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = 'sources'::regclass
      AND "conname" = 'sources_deletion_lifecycle_ck'
  ) THEN
    ALTER TABLE "sources"
      ADD CONSTRAINT "sources_deletion_lifecycle_ck" CHECK (
        (
          "status" = 'deleting'
          AND "deletion_job_id" IS NOT NULL
          AND "deleting_at" IS NOT NULL
        )
        OR (
          "status" <> 'deleting'
          AND "deletion_job_id" IS NULL
          AND "deleting_at" IS NULL
        )
      );
  END IF;
END
$kfs_0017_sources_deletion_lifecycle_ck$;

DO $kfs_0017_document_assets_deletion_lifecycle_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint"
    WHERE "conrelid" = 'document_assets'::regclass
      AND "conname" = 'document_assets_deletion_lifecycle_ck'
  ) THEN
    ALTER TABLE "document_assets"
      ADD CONSTRAINT "document_assets_deletion_lifecycle_ck" CHECK (
        "row_version" >= 1
        AND (
          ("lifecycle_state" = 'active' AND "deletion_job_id" IS NULL AND "deleting_at" IS NULL)
          OR
          ("lifecycle_state" = 'deleting' AND "deletion_job_id" IS NOT NULL AND "deleting_at" IS NOT NULL)
        )
      );
  END IF;
END
$kfs_0017_document_assets_deletion_lifecycle_ck$;

-- Retrieval execution leases are durable, token-fenced evidence that a request may still be
-- reading the space. Deletion drains active leases before destructive cleanup and can reclaim
-- only rows whose heartbeat has expired.
CREATE TABLE IF NOT EXISTS "retrieval_execution_leases" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "subject_id" TEXT NOT NULL,
  "trace_id" UUID NOT NULL,
  "lease_token" VARCHAR(128) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "row_version" INTEGER NOT NULL,
  "acquired_at" TIMESTAMPTZ NOT NULL,
  "heartbeat_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "retrieval_execution_leases_state_ck" CHECK (
    "status" IN ('active', 'released', 'expired')
    AND "row_version" >= 0
    AND "heartbeat_at" >= "acquired_at"
    AND "expires_at" > "heartbeat_at"
    AND "updated_at" >= "acquired_at"
  ),
  CONSTRAINT "retrieval_execution_leases_space_fk"
    FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "retrieval_execution_leases_space_expiry_idx"
  ON "retrieval_execution_leases" (
    "tenant_id", "knowledge_space_id", "status", "expires_at", "id"
  );

-- Jobs intentionally have no FK to any resource or permission snapshot that they delete. The
-- copied tenant/scope/requester fields are a durable authorization and audit record.
CREATE TABLE IF NOT EXISTS "deletion_jobs" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "target_type" VARCHAR(32) NOT NULL,
  "target_id" UUID NOT NULL,
  "target_revision" INTEGER NOT NULL,
  "delete_mode" VARCHAR(16) NOT NULL,
  "requested_by_subject_id" VARCHAR(255) NOT NULL,
  "permission_snapshot_id" UUID NOT NULL,
  "permission_snapshot_revision" INTEGER NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "api_key_id" UUID,
  "api_key_revision" INTEGER,
  "api_key_expires_at" TIMESTAMPTZ,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "name_challenge_digest" CHAR(64),
  "checkpoint" VARCHAR(32) NOT NULL,
  "scan_phase" VARCHAR(64),
  "scan_cursor" VARCHAR(1024),
  "inventory_complete" BOOLEAN NOT NULL,
  "run_state" VARCHAR(16) NOT NULL,
  "active_slot" INTEGER,
  "execution_attempts" INTEGER NOT NULL,
  "max_execution_attempts" INTEGER NOT NULL,
  "retry_at" TIMESTAMPTZ,
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "queue_job_id" VARCHAR(255),
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "row_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "deletion_jobs_target_ck" CHECK (
    "target_type" IN ('knowledge_space', 'source', 'document_asset')
    AND (
      ("target_type" = 'source' AND "delete_mode" IN ('keep', 'cascade') AND "name_challenge_digest" IS NULL)
      OR
      ("target_type" = 'knowledge_space' AND "delete_mode" = 'cascade' AND "name_challenge_digest" IS NOT NULL)
      OR
      ("target_type" = 'document_asset' AND "delete_mode" = 'cascade' AND "name_challenge_digest" IS NULL)
    )
  ),
  CONSTRAINT "deletion_jobs_checkpoint_ck" CHECK (
    "checkpoint" IN (
      'requested', 'quiescing', 'deleting_objects', 'deleting_derived_data',
      'deleting_primary_data', 'completed'
    )
  ),
  CONSTRAINT "deletion_jobs_run_state_ck" CHECK (
    "run_state" IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled')
  ),
  CONSTRAINT "deletion_jobs_access_channel_ck" CHECK (
    "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  CONSTRAINT "deletion_jobs_api_key_binding_ck" CHECK (
    (
      "api_key_id" IS NULL
      AND "api_key_revision" IS NULL
      AND "api_key_expires_at" IS NULL
    )
    OR (
      "api_key_id" IS NOT NULL
      AND "api_key_revision" >= 1
      AND "access_channel" = 'service_api'
    )
  ),
  CONSTRAINT "deletion_jobs_positive_ck" CHECK (
    "target_revision" >= 1
    AND "permission_snapshot_revision" >= 1
    AND "row_version" >= 1
    AND "execution_attempts" >= 0
    AND "max_execution_attempts" >= 1
    AND "execution_attempts" <= "max_execution_attempts"
    AND ("active_slot" IS NULL OR "active_slot" = 1)
  ),
  CONSTRAINT "deletion_jobs_lifecycle_ck" CHECK (
    (
      "run_state" IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'failed')
      AND "active_slot" = 1
      AND "completed_at" IS NULL
    )
    OR (
      "run_state" IN ('succeeded', 'canceled')
      AND "active_slot" IS NULL
      AND "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "deletion_jobs_completion_ck" CHECK (
    ("run_state" = 'succeeded' AND "checkpoint" = 'completed')
    OR ("run_state" <> 'succeeded' AND "checkpoint" <> 'completed')
  ),
  CONSTRAINT "deletion_jobs_retry_ck" CHECK (
    ("run_state" = 'retry_wait' AND "retry_at" IS NOT NULL)
    OR ("run_state" <> 'retry_wait' AND "retry_at" IS NULL)
  ),
  CONSTRAINT "deletion_jobs_lease_ck" CHECK (
    (
      "run_state" = 'running'
      AND "worker_id" IS NOT NULL
      AND "lease_token" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL
      AND "heartbeat_at" IS NOT NULL
    )
    OR (
      "run_state" <> 'running'
      AND "worker_id" IS NULL
      AND "lease_token" IS NULL
      AND "lease_expires_at" IS NULL
      AND "heartbeat_at" IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_jobs_idempotency_uq"
  ON "deletion_jobs" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_jobs_target_active_uq"
  ON "deletion_jobs" (
    "tenant_id", "knowledge_space_id", "target_type", "target_id", "active_slot"
  );
CREATE INDEX IF NOT EXISTS "deletion_jobs_claim_idx"
  ON "deletion_jobs" ("run_state", "retry_at", "lease_expires_at", "created_at", "id");
CREATE INDEX IF NOT EXISTS "deletion_jobs_scope_history_idx"
  ON "deletion_jobs" ("tenant_id", "knowledge_space_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "deletion_jobs_requester_provenance_idx"
  ON "deletion_jobs" (
    "tenant_id", "knowledge_space_id", "requested_by_subject_id",
    "api_key_id", "api_key_revision", "created_at", "id"
  );

-- Tombstones have no FK, including no FK back to the job, so the permanent no-republish fence
-- survives resource deletion and independent job retention.
CREATE TABLE IF NOT EXISTS "deletion_tombstones" (
  "id" UUID PRIMARY KEY NOT NULL,
  "deletion_job_id" UUID NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "target_type" VARCHAR(32) NOT NULL,
  "target_id" UUID NOT NULL,
  "target_revision" INTEGER NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "row_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "deletion_tombstones_target_ck" CHECK (
    "target_type" IN ('knowledge_space', 'source', 'document_asset')
  ),
  CONSTRAINT "deletion_tombstones_state_ck" CHECK (
    ("state" = 'active' AND "completed_at" IS NULL)
    OR ("state" = 'completed' AND "completed_at" IS NOT NULL)
  ),
  CONSTRAINT "deletion_tombstones_positive_ck" CHECK (
    "target_revision" >= 1 AND "row_version" >= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_tombstones_target_uq"
  ON "deletion_tombstones" ("tenant_id", "target_type", "target_id");
CREATE INDEX IF NOT EXISTS "deletion_tombstones_space_target_idx"
  ON "deletion_tombstones" ("tenant_id", "knowledge_space_id", "target_type", "target_id");
CREATE INDEX IF NOT EXISTS "deletion_tombstones_job_idx"
  ON "deletion_tombstones" ("deletion_job_id", "id");

CREATE TABLE IF NOT EXISTS "deletion_job_items" (
  "id" UUID PRIMARY KEY NOT NULL,
  "deletion_job_id" UUID NOT NULL,
  "ordinal" BIGINT NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "resource_id" UUID,
  "object_key" TEXT,
  "credential_ref" TEXT,
  "cache_key" TEXT,
  "payload_digest" CHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "attempts" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL,
  "next_attempt_at" TIMESTAMPTZ,
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "row_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  "redacted_at" TIMESTAMPTZ,
  CONSTRAINT "deletion_job_items_kind_ck" CHECK (
    "kind" IN ('object', 'secret_ref', 'cache_key', 'document_cascade', 'document_detach')
  ),
  CONSTRAINT "deletion_job_items_status_ck" CHECK (
    "status" IN ('pending', 'retry_wait', 'completed', 'dead')
  ),
  CONSTRAINT "deletion_job_items_positive_ck" CHECK (
    "ordinal" >= 0 AND "attempts" >= 0 AND "max_attempts" >= 1
    AND "attempts" <= "max_attempts" AND "row_version" >= 1
  ),
  CONSTRAINT "deletion_job_items_retry_ck" CHECK (
    ("status" = 'retry_wait' AND "next_attempt_at" IS NOT NULL)
    OR ("status" <> 'retry_wait' AND "next_attempt_at" IS NULL)
  ),
  CONSTRAINT "deletion_job_items_terminal_ck" CHECK (
    ("status" IN ('completed', 'dead') AND "completed_at" IS NOT NULL)
    OR ("status" IN ('pending', 'retry_wait') AND "completed_at" IS NULL)
  ),
  CONSTRAINT "deletion_job_items_payload_ck" CHECK (
    (
      "kind" = 'object' AND "credential_ref" IS NULL AND "cache_key" IS NULL
      AND (
        ("status" = 'completed' AND "object_key" IS NULL AND "redacted_at" IS NOT NULL)
        OR ("status" <> 'completed' AND "object_key" IS NOT NULL AND "redacted_at" IS NULL)
      )
    )
    OR (
      "kind" = 'secret_ref' AND "object_key" IS NULL AND "cache_key" IS NULL
      AND (
        ("status" = 'completed' AND "credential_ref" IS NULL AND "redacted_at" IS NOT NULL)
        OR ("status" <> 'completed' AND "credential_ref" IS NOT NULL AND "redacted_at" IS NULL)
      )
    )
    OR (
      "kind" = 'cache_key' AND "object_key" IS NULL AND "credential_ref" IS NULL
      AND (
        ("status" = 'completed' AND "cache_key" IS NULL AND "redacted_at" IS NOT NULL)
        OR ("status" <> 'completed' AND "cache_key" IS NOT NULL AND "redacted_at" IS NULL)
      )
    )
    OR (
      "kind" IN ('document_cascade', 'document_detach')
      AND "resource_id" IS NOT NULL AND "object_key" IS NULL
      AND "credential_ref" IS NULL AND "cache_key" IS NULL AND "redacted_at" IS NULL
    )
  ),
  FOREIGN KEY ("deletion_job_id") REFERENCES "deletion_jobs" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_job_items_idempotency_uq"
  ON "deletion_job_items" ("deletion_job_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_job_items_ordinal_uq"
  ON "deletion_job_items" ("deletion_job_id", "ordinal");
CREATE INDEX IF NOT EXISTS "deletion_job_items_work_idx"
  ON "deletion_job_items" (
    "deletion_job_id", "status", "next_attempt_at", "ordinal", "id"
  );
CREATE INDEX IF NOT EXISTS "deletion_job_items_resource_idx"
  ON "deletion_job_items" ("deletion_job_id", "kind", "resource_id", "id");

CREATE TABLE IF NOT EXISTS "deletion_outbox" (
  "id" UUID PRIMARY KEY NOT NULL,
  "deletion_job_id" UUID NOT NULL,
  "delivery_revision" INTEGER NOT NULL,
  "event_type" VARCHAR(32) NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "request_idempotency_key" VARCHAR(512) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "available_at" TIMESTAMPTZ NOT NULL,
  "dispatch_attempts" INTEGER NOT NULL,
  "locked_by" VARCHAR(255),
  "locked_until" TIMESTAMPTZ,
  "lock_token" UUID,
  "queue_job_id" VARCHAR(255),
  "last_error" TEXT,
  "delivered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "deletion_outbox_event_ck" CHECK ("event_type" = 'deletion.job'),
  CONSTRAINT "deletion_outbox_schema_ck" CHECK ("schema_version" = 1),
  CONSTRAINT "deletion_outbox_status_ck" CHECK (
    "status" IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')
  ),
  CONSTRAINT "deletion_outbox_positive_ck" CHECK (
    "delivery_revision" >= 1 AND "dispatch_attempts" >= 0
  ),
  CONSTRAINT "deletion_outbox_lock_ck" CHECK (
    ("lock_token" IS NULL AND "locked_by" IS NULL AND "locked_until" IS NULL)
    OR ("lock_token" IS NOT NULL AND "locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)
  ),
  FOREIGN KEY ("deletion_job_id") REFERENCES "deletion_jobs" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_outbox_idempotency_uq"
  ON "deletion_outbox" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_outbox_job_delivery_uq"
  ON "deletion_outbox" ("deletion_job_id", "delivery_revision");
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_outbox_job_request_uq"
  ON "deletion_outbox" ("deletion_job_id", "request_idempotency_key");
CREATE INDEX IF NOT EXISTS "deletion_outbox_claim_idx"
  ON "deletion_outbox" ("status", "available_at", "locked_until", "id");

-- Every manual retry has immutable actor provenance. This is intentionally separate from
-- deletion_jobs: an owner rescue must never overwrite the original deletion requester, and there
-- is deliberately no FK to the permission snapshot or target space because both may be deleted.
CREATE TABLE IF NOT EXISTS "deletion_retry_audits" (
  "id" UUID PRIMARY KEY NOT NULL,
  "deletion_job_id" UUID NOT NULL,
  "outbox_id" UUID NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "retry_authority" VARCHAR(32) NOT NULL,
  "actor_subject_id" VARCHAR(255) NOT NULL,
  "permission_snapshot_id" UUID NOT NULL,
  "permission_snapshot_revision" INTEGER NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "api_key_id" UUID,
  "api_key_revision" INTEGER,
  "api_key_expires_at" TIMESTAMPTZ,
  "request_idempotency_key" VARCHAR(512) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "deletion_retry_audits_authority_ck" CHECK (
    "retry_authority" IN ('original_requester', 'interactive_owner_rescue')
  ),
  CONSTRAINT "deletion_retry_audits_access_channel_ck" CHECK (
    "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  CONSTRAINT "deletion_retry_audits_positive_ck" CHECK (
    "permission_snapshot_revision" >= 1
  ),
  CONSTRAINT "deletion_retry_audits_api_key_binding_ck" CHECK (
    (
      "api_key_id" IS NULL
      AND "api_key_revision" IS NULL
      AND "api_key_expires_at" IS NULL
    )
    OR (
      "api_key_id" IS NOT NULL
      AND "api_key_revision" >= 1
      AND "access_channel" = 'service_api'
    )
  ),
  CONSTRAINT "deletion_retry_audits_owner_rescue_ck" CHECK (
    "retry_authority" <> 'interactive_owner_rescue'
    OR (
      "access_channel" = 'interactive'
      AND "api_key_id" IS NULL
      AND "api_key_revision" IS NULL
      AND "api_key_expires_at" IS NULL
    )
  ),
  FOREIGN KEY ("deletion_job_id") REFERENCES "deletion_jobs" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_retry_audits_job_request_uq"
  ON "deletion_retry_audits" ("deletion_job_id", "request_idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "deletion_retry_audits_outbox_uq"
  ON "deletion_retry_audits" ("outbox_id");
CREATE INDEX IF NOT EXISTS "deletion_retry_audits_actor_idx"
  ON "deletion_retry_audits" (
    "tenant_id", "knowledge_space_id", "actor_subject_id", "created_at", "id"
  );

CREATE INDEX IF NOT EXISTS "knowledge_spaces_lifecycle_idx"
  ON "knowledge_spaces" ("tenant_id", "lifecycle_state", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "sources_deletion_job_idx"
  ON "sources" ("knowledge_space_id", "deletion_job_id", "id");
CREATE INDEX IF NOT EXISTS "document_assets_lifecycle_idx"
  ON "document_assets" ("knowledge_space_id", "lifecycle_state", "source_id", "version", "id");
CREATE INDEX IF NOT EXISTS "page_index_manifests_document_idx"
  ON "page_index_manifests" ("document_asset_id", "publication_generation_id", "id");

-- Agent workspace snapshots contain command logs and opaque metadata that cannot be attributed to
-- one document after the fact. Persist exact creator authorization and support whole-space
-- invalidation so every API replica observes deletion immediately.
CREATE TABLE IF NOT EXISTS "agent_workspace_snapshots" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "subject_id" VARCHAR(255) NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "permission_snapshot_id" UUID NOT NULL,
  "permission_snapshot_revision" INTEGER NOT NULL,
  "permission_scopes" JSONB NOT NULL,
  "fingerprint" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "invalidated_at" TIMESTAMPTZ,
  "invalidation_reason" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "agent_workspace_snapshots_channel_ck" CHECK (
    "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
  ),
  CONSTRAINT "agent_workspace_snapshots_revision_ck" CHECK (
    "permission_snapshot_revision" >= 1
  ),
  CONSTRAINT "agent_workspace_snapshots_invalidation_ck" CHECK (
    ("invalidated_at" IS NULL AND "invalidation_reason" IS NULL)
    OR ("invalidated_at" IS NOT NULL AND "invalidation_reason" IS NOT NULL)
  ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "agent_workspace_snapshots_tenant_lookup_idx"
  ON "agent_workspace_snapshots" ("tenant_id", "id", "invalidated_at");
CREATE INDEX IF NOT EXISTS "agent_workspace_snapshots_space_cleanup_idx"
  ON "agent_workspace_snapshots" (
    "tenant_id", "knowledge_space_id", "invalidated_at", "id"
  );
