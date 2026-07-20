-- Knowledge Platform schema migration
-- Migration id: 0020_profile_migration_runs
-- Dialect: postgres

-- A profile change over a populated space is a durable rebuild. The run freezes the old
-- publication, both old profile heads, and the immutable candidate revision before any worker
-- starts. Only the joint profile/publication CAS may make the candidate visible.
CREATE TABLE IF NOT EXISTS "knowledge_space_profile_migration_runs" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "changed_kind" VARCHAR(16) NOT NULL,
  "rebuild_scope" VARCHAR(48) NOT NULL,
  "candidate_profile_kind" VARCHAR(16) NOT NULL,
  "candidate_profile_revision_id" UUID NOT NULL,
  "candidate_profile_revision" INTEGER NOT NULL,
  "candidate_profile_snapshot_digest" CHAR(64) NOT NULL,
  "base_embedding_profile_kind" VARCHAR(16),
  "base_embedding_profile_revision_id" UUID,
  "base_embedding_profile_revision" INTEGER,
  "base_embedding_profile_snapshot_digest" CHAR(64),
  "base_retrieval_profile_kind" VARCHAR(16) NOT NULL,
  "base_retrieval_profile_revision_id" UUID NOT NULL,
  "base_retrieval_profile_revision" INTEGER NOT NULL,
  "base_retrieval_profile_snapshot_digest" CHAR(64) NOT NULL,
  "base_publication_id" UUID NOT NULL,
  "base_publication_fingerprint" VARCHAR(86) NOT NULL,
  "base_publication_head_revision" INTEGER NOT NULL,
  "candidate_publication_id" UUID,
  "candidate_publication_fingerprint" VARCHAR(86),
  "permission_snapshot_id" UUID NOT NULL,
  "permission_snapshot_revision" INTEGER NOT NULL,
  "requested_by_subject_id" VARCHAR(255) NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "idempotency_digest" CHAR(64) NOT NULL,
  "run_state" VARCHAR(16) NOT NULL,
  "active_slot" INTEGER,
  "checkpoint" VARCHAR(32) NOT NULL,
  "evaluation_summary" JSONB,
  "execution_attempts" INTEGER NOT NULL,
  "max_execution_attempts" INTEGER NOT NULL,
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "row_version" INTEGER NOT NULL,
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  "canceled_at" TIMESTAMPTZ,
  CONSTRAINT "knowledge_space_profile_migration_runs_kind_ck"
    CHECK (
      "changed_kind" IN ('embedding', 'retrieval')
      AND "candidate_profile_kind" = "changed_kind"
      AND "base_retrieval_profile_kind" = 'retrieval'
      AND ("base_embedding_profile_kind" IS NULL OR "base_embedding_profile_kind" = 'embedding')
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_scope_ck"
    CHECK (
      ("changed_kind" = 'embedding' AND "rebuild_scope" = 'full-vector-space')
      OR ("changed_kind" = 'retrieval' AND "rebuild_scope" IN (
        'clone-publication', 'full-page-index-summary-outline'
      ))
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_state_ck"
    CHECK ("run_state" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT "knowledge_space_profile_migration_runs_checkpoint_ck"
    CHECK ("checkpoint" IN ('queued', 'candidate-built', 'evaluated', 'activated')),
  CONSTRAINT "knowledge_space_profile_migration_runs_idempotency_digest_ck"
    CHECK ("idempotency_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "knowledge_space_profile_migration_runs_positive_ck"
    CHECK (
      "candidate_profile_revision" >= 1
      AND "base_retrieval_profile_revision" >= 1
      AND "base_publication_head_revision" >= 1
      AND "permission_snapshot_revision" >= 1
      AND "execution_attempts" >= 0
      AND "max_execution_attempts" >= 1
      AND "execution_attempts" <= "max_execution_attempts"
      AND "row_version" >= 1
      AND ("active_slot" IS NULL OR "active_slot" = 1)
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_embedding_ref_ck"
    CHECK (
      ("base_embedding_profile_kind" IS NULL
        AND "base_embedding_profile_revision_id" IS NULL
        AND "base_embedding_profile_revision" IS NULL
        AND "base_embedding_profile_snapshot_digest" IS NULL)
      OR ("base_embedding_profile_kind" = 'embedding'
        AND "base_embedding_profile_revision_id" IS NOT NULL
        AND "base_embedding_profile_revision" >= 1
        AND "base_embedding_profile_snapshot_digest" IS NOT NULL)
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_candidate_publication_ck"
    CHECK (
      ("candidate_publication_id" IS NULL AND "candidate_publication_fingerprint" IS NULL)
      OR ("candidate_publication_id" IS NOT NULL AND "candidate_publication_fingerprint" IS NOT NULL)
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_checkpoint_shape_ck"
    CHECK (
      (
        "checkpoint" = 'queued'
        AND "candidate_publication_id" IS NULL
        AND "candidate_publication_fingerprint" IS NULL
        AND "evaluation_summary" IS NULL
      )
      OR (
        "checkpoint" = 'candidate-built'
        AND "candidate_publication_id" IS NOT NULL
        AND "candidate_publication_fingerprint" IS NOT NULL
        AND "evaluation_summary" IS NULL
      )
      OR (
        "checkpoint" IN ('evaluated', 'activated')
        AND "candidate_publication_id" IS NOT NULL
        AND "candidate_publication_fingerprint" IS NOT NULL
        AND "evaluation_summary" IS NOT NULL
        AND jsonb_typeof("evaluation_summary") = 'object'
      )
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_lease_ck"
    CHECK (
      ("run_state" = 'running' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
      OR ("run_state" <> 'running' AND "worker_id" IS NULL AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL)
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_lease_token_ck"
    CHECK (
      "lease_token" IS NULL
      OR "lease_token" <> '00000000-0000-0000-0000-000000000000'::uuid
    ),
  CONSTRAINT "knowledge_space_profile_migration_runs_lifecycle_ck"
    CHECK (
      ("run_state" IN ('queued', 'running') AND "active_slot" = 1 AND "completed_at" IS NULL
        AND "canceled_at" IS NULL)
      OR ("run_state" = 'succeeded' AND "checkpoint" = 'activated'
        AND "active_slot" IS NULL AND "completed_at" IS NOT NULL AND "canceled_at" IS NULL
        AND "last_error_code" IS NULL AND "last_error_message" IS NULL)
      OR ("run_state" = 'failed' AND "completed_at" IS NOT NULL
        AND "active_slot" IS NULL AND "canceled_at" IS NULL AND "last_error_code" IS NOT NULL
        AND "last_error_message" IS NOT NULL)
      OR ("run_state" = 'canceled' AND "completed_at" IS NOT NULL
        AND "active_slot" IS NULL AND "canceled_at" IS NOT NULL)
    ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "candidate_profile_kind",
    "candidate_profile_revision_id", "candidate_profile_revision",
    "candidate_profile_snapshot_digest"
  ) REFERENCES "knowledge_space_profile_revisions" (
    "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "base_embedding_profile_kind",
    "base_embedding_profile_revision_id", "base_embedding_profile_revision",
    "base_embedding_profile_snapshot_digest"
  ) REFERENCES "knowledge_space_profile_revisions" (
    "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "base_retrieval_profile_kind",
    "base_retrieval_profile_revision_id", "base_retrieval_profile_revision",
    "base_retrieval_profile_snapshot_digest"
  ) REFERENCES "knowledge_space_profile_revisions" (
    "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "base_publication_id", "base_publication_fingerprint"
  ) REFERENCES "projection_set_publications" (
    "tenant_id", "knowledge_space_id", "id", "fingerprint"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "candidate_publication_id",
    "candidate_publication_fingerprint"
  ) REFERENCES "projection_set_publications" (
    "tenant_id", "knowledge_space_id", "id", "fingerprint"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "permission_snapshot_id",
    "requested_by_subject_id", "access_channel"
  )
    REFERENCES "knowledge_space_permission_snapshots" (
      "tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"
    ) ON DELETE RESTRICT
);

-- Recover a table left by an earlier attempt that failed while creating the oversized composite
-- key. The original tuple remains stored and is compared after digest lookup for collision safety.
ALTER TABLE "knowledge_space_profile_migration_runs"
  ADD COLUMN IF NOT EXISTS "idempotency_digest" CHAR(64);
UPDATE "knowledge_space_profile_migration_runs"
SET "idempotency_digest" = encode(sha256(convert_to(
  'v1|'
  || octet_length("tenant_id")::text || ':' || "tenant_id" || '|'
  || octet_length("knowledge_space_id"::text)::text || ':' || "knowledge_space_id"::text || '|'
  || octet_length("requested_by_subject_id")::text || ':' || "requested_by_subject_id" || '|'
  || octet_length("idempotency_key")::text || ':' || "idempotency_key" || '|',
  'UTF8'
)), 'hex')
WHERE "idempotency_digest" IS NULL;
ALTER TABLE "knowledge_space_profile_migration_runs"
  ALTER COLUMN "idempotency_digest" SET NOT NULL;

DROP INDEX IF EXISTS "knowledge_space_profile_migration_runs_idempotency_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_migration_runs_idempotency_digest_uq"
  ON "knowledge_space_profile_migration_runs" ("idempotency_digest");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_migration_runs_active_uq"
  ON "knowledge_space_profile_migration_runs" (
    "tenant_id", "knowledge_space_id", "active_slot"
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_profile_migration_runs_claim_idx"
  ON "knowledge_space_profile_migration_runs" (
    "run_state", "lease_expires_at", "updated_at", "id"
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_profile_migration_runs_space_idx"
  ON "knowledge_space_profile_migration_runs" (
    "tenant_id", "knowledge_space_id", "created_at", "id"
  );

CREATE TABLE IF NOT EXISTS "knowledge_space_profile_migration_outbox" (
  "id" UUID PRIMARY KEY NOT NULL,
  "run_id" UUID NOT NULL,
  "delivery_revision" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "available_at" TIMESTAMPTZ NOT NULL,
  "locked_by" VARCHAR(255),
  "lock_token" UUID,
  "locked_until" TIMESTAMPTZ,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "delivered_at" TIMESTAMPTZ,
  CONSTRAINT "knowledge_space_profile_migration_outbox_state_ck"
    CHECK ("status" IN ('pending', 'leased', 'completed', 'canceled')),
  CONSTRAINT "knowledge_space_profile_migration_outbox_positive_ck"
    CHECK ("delivery_revision" >= 1),
  CONSTRAINT "knowledge_space_profile_migration_outbox_lock_ck"
    CHECK (
      ("status" = 'leased' AND "locked_by" IS NOT NULL AND "lock_token" IS NOT NULL
        AND "locked_until" IS NOT NULL)
      OR ("status" <> 'leased' AND "locked_by" IS NULL AND "lock_token" IS NULL
        AND "locked_until" IS NULL)
    ),
  CONSTRAINT "knowledge_space_profile_migration_outbox_lock_token_ck"
    CHECK (
      "lock_token" IS NULL
      OR "lock_token" <> '00000000-0000-0000-0000-000000000000'::uuid
    ),
  FOREIGN KEY ("run_id")
    REFERENCES "knowledge_space_profile_migration_runs" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_migration_outbox_delivery_uq"
  ON "knowledge_space_profile_migration_outbox" ("run_id", "delivery_revision");
CREATE INDEX IF NOT EXISTS "knowledge_space_profile_migration_outbox_claim_idx"
  ON "knowledge_space_profile_migration_outbox" (
    "status", "available_at", "locked_until", "id"
  );
