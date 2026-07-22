-- Knowledge Platform schema migration
-- Migration id: 0015_research_task_jobs
-- Dialect: postgres

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_permission_snapshots_provenance_uq"
  ON "knowledge_space_permission_snapshots" (
    "tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"
  );
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_permission_snapshots_trace_provenance_uq"
  ON "knowledge_space_permission_snapshots" (
    "knowledge_space_id", "id", "subject_id", "access_channel"
  );

CREATE TABLE IF NOT EXISTS "research_task_jobs" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "subject_id" VARCHAR(255) NOT NULL,
  "permission_snapshot_id" UUID NOT NULL,
  "permission_snapshot_revision" INTEGER NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "query" TEXT NOT NULL,
  "mode" VARCHAR(16),
  "top_k" INTEGER,
  "budget_usd" DOUBLE PRECISION,
  "limits" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "cost" JSONB NOT NULL,
  "stage" VARCHAR(16) NOT NULL,
  "paused_from_stage" VARCHAR(16),
  "queue_job_id" VARCHAR(255),
  "error" TEXT,
  "resume_after" BIGINT,
  "paused_at" BIGINT,
  "completed_at" BIGINT,
  "row_version" INTEGER NOT NULL,
  "execution_attempts" INTEGER NOT NULL,
  "max_execution_attempts" INTEGER NOT NULL,
  "worker_id" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" BIGINT,
  "heartbeat_at" BIGINT,
  "retry_at" BIGINT,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "research_task_jobs_stage_ck" CHECK (
    "stage" IN (
      'queued', 'planning', 'retrieving', 'analyzing', 'generating',
      'paused', 'completed', 'failed', 'canceled'
    )
  ),
  CONSTRAINT "research_task_jobs_mode_ck"
    CHECK ("mode" IS NULL OR "mode" IN ('auto', 'fast', 'research', 'deep')),
  CONSTRAINT "research_task_jobs_channel_ck"
    CHECK ("access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')),
  CONSTRAINT "research_task_jobs_positive_ck" CHECK (
    "permission_snapshot_revision" >= 1
    AND "row_version" >= 1
    AND "execution_attempts" >= 0
    AND "max_execution_attempts" >= 1
    AND ("top_k" IS NULL OR "top_k" >= 1)
    AND ("budget_usd" IS NULL OR "budget_usd" >= 0)
  ),
  CONSTRAINT "research_task_jobs_lease_ck" CHECK (
    ("lease_token" IS NULL AND "worker_id" IS NULL AND "lease_expires_at" IS NULL)
    OR ("lease_token" IS NOT NULL AND "worker_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "permission_snapshot_id", "subject_id", "access_channel"
  )
    REFERENCES "knowledge_space_permission_snapshots" (
      "tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"
    ) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "research_task_jobs_scope_updated_idx"
  ON "research_task_jobs" (
    "tenant_id", "knowledge_space_id", "updated_at", "id"
  );
CREATE INDEX IF NOT EXISTS "research_task_jobs_queue_idx"
  ON "research_task_jobs" ("queue_job_id", "id");
CREATE INDEX IF NOT EXISTS "research_task_jobs_lease_idx"
  ON "research_task_jobs" ("stage", "lease_expires_at", "retry_at", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "research_task_jobs_scope_id_uq"
  ON "research_task_jobs" ("tenant_id", "knowledge_space_id", "id");

CREATE TABLE IF NOT EXISTS "research_task_outbox" (
  "id" UUID PRIMARY KEY NOT NULL,
  "research_task_job_id" UUID NOT NULL,
  "delivery_revision" INTEGER NOT NULL,
  "event_type" VARCHAR(32) NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "available_at" BIGINT NOT NULL,
  "dispatch_attempts" INTEGER NOT NULL,
  "locked_by" VARCHAR(255),
  "locked_until" BIGINT,
  "lock_token" UUID,
  "queue_job_id" VARCHAR(255),
  "last_error" TEXT,
  "delivered_at" BIGINT,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  CONSTRAINT "research_task_outbox_event_ck" CHECK ("event_type" = 'research.task'),
  CONSTRAINT "research_task_outbox_schema_ck" CHECK ("schema_version" = 1),
  CONSTRAINT "research_task_outbox_status_ck" CHECK (
    "status" IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')
  ),
  CONSTRAINT "research_task_outbox_positive_ck" CHECK (
    "delivery_revision" >= 1 AND "dispatch_attempts" >= 0
  ),
  CONSTRAINT "research_task_outbox_lock_ck" CHECK (
    ("lock_token" IS NULL AND "locked_by" IS NULL AND "locked_until" IS NULL)
    OR ("lock_token" IS NOT NULL AND "locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)
  ),
  FOREIGN KEY ("research_task_job_id") REFERENCES "research_task_jobs" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "research_task_outbox_idempotency_uq"
  ON "research_task_outbox" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "research_task_outbox_job_delivery_uq"
  ON "research_task_outbox" ("research_task_job_id", "delivery_revision");
CREATE INDEX IF NOT EXISTS "research_task_outbox_claim_idx"
  ON "research_task_outbox" ("status", "available_at", "locked_until", "id");

CREATE TABLE IF NOT EXISTS "research_task_partial_results" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "research_task_job_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "evidence_bundle" JSONB NOT NULL,
  "created_at" BIGINT NOT NULL,
  FOREIGN KEY ("research_task_job_id") REFERENCES "research_task_jobs" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "research_task_partials_job_sequence_uq"
  ON "research_task_partial_results" ("research_task_job_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "research_task_partials_job_idempotency_uq"
  ON "research_task_partial_results" ("research_task_job_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "research_task_partials_scope_job_sequence_idx"
  ON "research_task_partial_results" (
    "tenant_id", "research_task_job_id", "sequence", "id"
  );

CREATE TABLE IF NOT EXISTS "research_task_progress_events" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "research_task_job_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(512) NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "stage" VARCHAR(16) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" BIGINT NOT NULL,
  CONSTRAINT "research_task_progress_sequence_ck" CHECK ("sequence" >= 1),
  CONSTRAINT "research_task_progress_event_ck" CHECK (
    "event_type" IN (
      'research_task.canceled', 'research_task.failed', 'research_task.paused',
      'research_task.resumed', 'research_task.stage_changed', 'research_task.started'
    )
  ),
  CONSTRAINT "research_task_progress_stage_ck" CHECK (
    "stage" IN (
      'queued', 'planning', 'retrieving', 'analyzing', 'generating',
      'paused', 'completed', 'failed', 'canceled'
    )
  ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id", "research_task_job_id")
    REFERENCES "research_task_jobs" ("tenant_id", "knowledge_space_id", "id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "research_task_progress_job_sequence_uq"
  ON "research_task_progress_events" ("research_task_job_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "research_task_progress_job_idempotency_uq"
  ON "research_task_progress_events" ("research_task_job_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "research_task_progress_scope_job_sequence_idx"
  ON "research_task_progress_events" (
    "tenant_id", "research_task_job_id", "sequence", "id"
  );

-- Durable grants issued from service API keys must remain coupled to the exact credential
-- revision and expiry. Null means the snapshot was issued by a non-key principal.
ALTER TABLE "knowledge_space_permission_snapshots"
  ADD COLUMN IF NOT EXISTS "api_key_id" UUID;
ALTER TABLE "knowledge_space_permission_snapshots"
  ADD COLUMN IF NOT EXISTS "api_key_revision" INTEGER;
ALTER TABLE "knowledge_space_permission_snapshots"
  ADD COLUMN IF NOT EXISTS "api_key_expires_at" TIMESTAMPTZ;
-- The migration runner records schema_migrations after executing this artifact. If the process
-- exits between those operations, the complete artifact is replayed. PostgreSQL has no
-- ADD CONSTRAINT IF NOT EXISTS, so every incremental constraint must be conditionally installed.
DO $kfs_0015_permission_snapshot_api_key_binding_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conrelid" = 'knowledge_space_permission_snapshots'::regclass
      AND "conname" = 'knowledge_space_permission_snapshots_api_key_binding_ck'
  ) THEN
    ALTER TABLE "knowledge_space_permission_snapshots"
      ADD CONSTRAINT "knowledge_space_permission_snapshots_api_key_binding_ck" CHECK (
        (
          "api_key_id" IS NULL
          AND "api_key_revision" IS NULL
          AND "api_key_expires_at" IS NULL
        )
        OR ("api_key_id" IS NOT NULL AND "api_key_revision" >= 1)
      );
  END IF;
END
$kfs_0015_permission_snapshot_api_key_binding_ck$;
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_api_keys_scope_id_uq"
  ON "knowledge_space_api_keys" ("tenant_id", "knowledge_space_id", "id");
DO $kfs_0015_permission_snapshot_api_key_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conrelid" = 'knowledge_space_permission_snapshots'::regclass
      AND "conname" = 'knowledge_space_permission_snapshots_api_key_fk'
  ) THEN
    ALTER TABLE "knowledge_space_permission_snapshots"
      ADD CONSTRAINT "knowledge_space_permission_snapshots_api_key_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id", "api_key_id")
      REFERENCES "knowledge_space_api_keys" ("tenant_id", "knowledge_space_id", "id")
      ON DELETE RESTRICT;
  END IF;
END
$kfs_0015_permission_snapshot_api_key_fk$;
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_permission_snapshots_space_id_uq"
  ON "knowledge_space_permission_snapshots" ("knowledge_space_id", "id");
CREATE INDEX IF NOT EXISTS "knowledge_space_permission_snapshots_api_key_idx"
  ON "knowledge_space_permission_snapshots" (
    "tenant_id", "knowledge_space_id", "api_key_id", "api_key_revision"
  );

-- Legacy rows intentionally remain unowned and are denied by the API. New AnswerTrace writers
-- always persist the authenticated subject so EvidenceBundle reads cannot cross members.
ALTER TABLE "answer_traces"
  ADD COLUMN IF NOT EXISTS "subject_id" VARCHAR(255);
ALTER TABLE "answer_traces"
  ADD COLUMN IF NOT EXISTS "permission_snapshot_id" UUID;
ALTER TABLE "answer_traces"
  ADD COLUMN IF NOT EXISTS "permission_snapshot_revision" INTEGER;
ALTER TABLE "answer_traces"
  ADD COLUMN IF NOT EXISTS "access_channel" VARCHAR(16);
DO $kfs_0015_answer_trace_permission_snapshot_binding_ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conrelid" = 'answer_traces'::regclass
      AND "conname" = 'answer_traces_permission_snapshot_binding_ck'
  ) THEN
    ALTER TABLE "answer_traces"
      ADD CONSTRAINT "answer_traces_permission_snapshot_binding_ck" CHECK (
        (
          "permission_snapshot_id" IS NULL
          AND "permission_snapshot_revision" IS NULL
          AND "access_channel" IS NULL
        )
        OR (
          "subject_id" IS NOT NULL
          AND
          "permission_snapshot_id" IS NOT NULL
          AND "permission_snapshot_revision" >= 1
          AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
        )
      );
  END IF;
END
$kfs_0015_answer_trace_permission_snapshot_binding_ck$;
DO $kfs_0015_answer_trace_permission_snapshot_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "pg_constraint"
    WHERE "conrelid" = 'answer_traces'::regclass
      AND "conname" = 'answer_traces_permission_snapshot_fk'
  ) THEN
    ALTER TABLE "answer_traces"
      ADD CONSTRAINT "answer_traces_permission_snapshot_fk"
      FOREIGN KEY (
        "knowledge_space_id", "permission_snapshot_id", "subject_id", "access_channel"
      )
      REFERENCES "knowledge_space_permission_snapshots" (
        "knowledge_space_id", "id", "subject_id", "access_channel"
      )
      ON DELETE RESTRICT;
  END IF;
END
$kfs_0015_answer_trace_permission_snapshot_fk$;
CREATE INDEX IF NOT EXISTS "answer_traces_space_subject_created_idx"
  ON "answer_traces" ("knowledge_space_id", "subject_id", "created_at", "id");
