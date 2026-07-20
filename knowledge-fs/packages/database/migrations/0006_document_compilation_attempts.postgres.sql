-- Knowledge Platform schema migration
-- Migration id: 0006_document_compilation_attempts
-- Dialect: postgres

-- Compilation state and queue publication live in one database transaction. active_slot is 1 only
-- while work is live; terminal rows are retained unless an explicit manual retry reactivates a
-- failed logical attempt. The unique key prevents two active attempts for the same tenant-scoped
-- document version.
ALTER TABLE "knowledge_spaces"
  ADD CONSTRAINT "knowledge_spaces_tenant_id_length_ck"
  CHECK (CHAR_LENGTH("tenant_id") <= 255);
ALTER TABLE "knowledge_spaces"
  ALTER COLUMN "tenant_id" TYPE VARCHAR(255)
  USING "tenant_id"::VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_spaces_tenant_id_uq"
  ON "knowledge_spaces" ("tenant_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_assets_space_id_version_uq"
  ON "document_assets" ("knowledge_space_id", "id", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "projection_set_publications_space_id_fingerprint_uq"
  ON "projection_set_publications" (
    "tenant_id",
    "knowledge_space_id",
    "id",
    "fingerprint"
  );

CREATE TABLE IF NOT EXISTS "document_compilation_attempts" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "document_asset_id" UUID NOT NULL,
  "document_version" INTEGER NOT NULL,
  "publication_generation_id" UUID NOT NULL,
  "base_head_revision" INTEGER NOT NULL,
  "candidate_publication_id" UUID,
  "candidate_fingerprint" VARCHAR(86),
  "checkpoint" VARCHAR(32) NOT NULL,
  "run_state" VARCHAR(16) NOT NULL,
  "active_slot" INTEGER,
  "execution_attempts" INTEGER NOT NULL,
  "max_execution_attempts" INTEGER NOT NULL,
  "queue_job_id" VARCHAR(255),
  "external_job_id" VARCHAR(255),
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "heartbeat_at" TIMESTAMPTZ,
  "retry_at" TIMESTAMPTZ,
  "last_error_code" VARCHAR(64),
  "last_error_message" TEXT,
  "row_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "document_compilation_attempts_generation_nonzero_ck"
    CHECK ("publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT "document_compilation_attempts_active_slot_ck"
    CHECK ("active_slot" IS NULL OR "active_slot" = 1),
  CONSTRAINT "document_compilation_attempts_document_version_ck"
    CHECK ("document_version" > 0),
  CONSTRAINT "document_compilation_attempts_base_revision_ck"
    CHECK ("base_head_revision" >= 0),
  CONSTRAINT "document_compilation_attempts_execution_count_ck"
    CHECK (
      "execution_attempts" >= 0
      AND "max_execution_attempts" > 0
      AND "execution_attempts" <= "max_execution_attempts"
    ),
  CONSTRAINT "document_compilation_attempts_row_version_ck"
    CHECK ("row_version" >= 0),
  CONSTRAINT "document_compilation_attempts_checkpoint_ck"
    CHECK (
      "checkpoint" IN (
        'queued',
        'parsed',
        'outline_built',
        'nodes_generated',
        'projection_built',
        'smoke_eval_passed',
        'published'
      )
    ),
  CONSTRAINT "document_compilation_attempts_run_state_ck"
    CHECK (
      "run_state" IN (
        'dispatch_pending',
        'queued',
        'running',
        'retry_wait',
        'succeeded',
        'failed',
        'canceled',
        'superseded'
      )
    ),
  CONSTRAINT "document_compilation_attempts_lifecycle_ck"
    CHECK (
      (
        "run_state" IN ('succeeded', 'failed', 'canceled', 'superseded')
        AND "active_slot" IS NULL
        AND "completed_at" IS NOT NULL
      )
      OR (
        "run_state" IN ('dispatch_pending', 'queued', 'running', 'retry_wait')
        AND "active_slot" = 1
        AND "completed_at" IS NULL
      )
    ),
  CONSTRAINT "document_compilation_attempts_retry_schedule_ck"
    CHECK (
      (
        "run_state" = 'retry_wait'
        AND "retry_at" IS NOT NULL
      )
      OR (
        "run_state" <> 'retry_wait'
        AND "retry_at" IS NULL
      )
    ),
  CONSTRAINT "document_compilation_attempts_candidate_pair_ck"
    CHECK (
      (
        "candidate_publication_id" IS NULL
        AND "candidate_fingerprint" IS NULL
      )
      OR (
        "candidate_publication_id" IS NOT NULL
        AND "candidate_fingerprint" IS NOT NULL
      )
    ),
  CONSTRAINT "document_compilation_attempts_lease_state_ck"
    CHECK (
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
    ),
  CONSTRAINT "document_compilation_attempts_lease_token_ck"
    CHECK (
      "lease_token" IS NULL
      OR "lease_token" <> '00000000-0000-0000-0000-000000000000'::uuid
    ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id")
    ON DELETE CASCADE,
  FOREIGN KEY ("knowledge_space_id", "document_asset_id", "document_version")
    REFERENCES "document_assets" ("knowledge_space_id", "id", "version")
    ON DELETE CASCADE,
  FOREIGN KEY (
    "tenant_id",
    "knowledge_space_id",
    "candidate_publication_id",
    "candidate_fingerprint"
  )
    REFERENCES "projection_set_publications" (
      "tenant_id",
      "knowledge_space_id",
      "id",
      "fingerprint"
    )
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_compilation_attempts_scope_version_active_uq"
  ON "document_compilation_attempts" (
    "tenant_id",
    "knowledge_space_id",
    "document_asset_id",
    "document_version",
    "active_slot"
  );
CREATE INDEX IF NOT EXISTS "document_compilation_attempts_run_schedule_idx"
  ON "document_compilation_attempts" ("run_state", "retry_at", "created_at", "id");
CREATE INDEX IF NOT EXISTS "document_compilation_attempts_lease_recovery_idx"
  ON "document_compilation_attempts" (
    "run_state",
    "lease_expires_at",
    "heartbeat_at",
    "id"
  );
CREATE INDEX IF NOT EXISTS "document_compilation_attempts_document_version_idx"
  ON "document_compilation_attempts" (
    "knowledge_space_id",
    "document_asset_id",
    "document_version",
    "id"
  );
CREATE INDEX IF NOT EXISTS "document_compilation_attempts_candidate_idx"
  ON "document_compilation_attempts" (
    "tenant_id",
    "knowledge_space_id",
    "candidate_publication_id",
    "candidate_fingerprint",
    "id"
  );
CREATE INDEX IF NOT EXISTS "document_compilation_attempts_tenant_completed_idx"
  ON "document_compilation_attempts" ("tenant_id", "completed_at", "id");

CREATE TABLE IF NOT EXISTS "document_compilation_outbox" (
  "id" UUID PRIMARY KEY NOT NULL,
  "attempt_id" UUID NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "dispatch_attempts" INTEGER NOT NULL,
  "available_at" TIMESTAMPTZ NOT NULL,
  "locked_by" VARCHAR(255),
  "lock_token" UUID,
  "locked_until" TIMESTAMPTZ,
  "queue_job_id" VARCHAR(255),
  "external_job_id" VARCHAR(255),
  "delivered_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "document_compilation_outbox_event_type_ck"
    CHECK ("event_type" = 'document.compile'),
  CONSTRAINT "document_compilation_outbox_schema_version_ck"
    CHECK ("schema_version" = 1),
  CONSTRAINT "document_compilation_outbox_status_ck"
    CHECK (
      "status" IN (
        'pending',
        'dispatching',
        'dispatched',
        'leased',
        'completed',
        'canceled',
        'dead'
      )
    ),
  CONSTRAINT "document_compilation_outbox_dispatch_attempts_ck"
    CHECK ("dispatch_attempts" >= 0),
  CONSTRAINT "document_compilation_outbox_lock_state_ck"
    CHECK (
      (
        "status" = 'dispatching'
        AND "locked_by" IS NOT NULL
        AND "lock_token" IS NOT NULL
        AND "locked_until" IS NOT NULL
      )
      OR (
        "status" <> 'dispatching'
        AND "locked_by" IS NULL
        AND "lock_token" IS NULL
        AND "locked_until" IS NULL
      )
    ),
  CONSTRAINT "document_compilation_outbox_lock_token_ck"
    CHECK (
      "lock_token" IS NULL
      OR "lock_token" <> '00000000-0000-0000-0000-000000000000'::uuid
    ),
  FOREIGN KEY ("attempt_id")
    REFERENCES "document_compilation_attempts" ("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_compilation_outbox_attempt_event_uq"
  ON "document_compilation_outbox" ("attempt_id", "event_type");
CREATE UNIQUE INDEX IF NOT EXISTS "document_compilation_outbox_idempotency_uq"
  ON "document_compilation_outbox" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "document_compilation_outbox_delivery_due_idx"
  ON "document_compilation_outbox" ("status", "available_at", "created_at", "id");
CREATE INDEX IF NOT EXISTS "document_compilation_outbox_lock_recovery_idx"
  ON "document_compilation_outbox" ("status", "locked_until", "created_at", "id");
