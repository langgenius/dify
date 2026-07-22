-- Knowledge Platform schema migration
-- Migration id: 0024_quality_control
-- Dialect: postgres
-- New-table-only DDL plus IF NOT EXISTS indexes keeps marker-loss replay safe.

CREATE UNIQUE INDEX IF NOT EXISTS "answer_traces_space_id_uq"
  ON "answer_traces" ("knowledge_space_id", "id");

CREATE TABLE IF NOT EXISTS "quality_replay_runs" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" VARCHAR(71) NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "requested_by_subject_id" VARCHAR(255) NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "permission_snapshot_id" UUID NOT NULL,
  "permission_snapshot_revision" INTEGER NOT NULL,
  "required_permission_scope" JSONB NOT NULL,
  "frozen_snapshot" JSONB NOT NULL,
  "revision" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "lease_owner" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quality_replay_runs_state_ck" CHECK (
    "mode" IN ('fast', 'research', 'deep')
    AND "state" IN ('queued', 'running', 'passed', 'failed', 'canceled')
  ),
  CONSTRAINT "quality_replay_runs_lease_ck" CHECK (
    ("state" = 'running' AND "lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL AND "completed_at" IS NULL)
    OR ("state" <> 'running' AND "lease_owner" IS NULL AND "lease_token" IS NULL
      AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "quality_replay_runs_terminal_ck" CHECK (
    ("state" IN ('passed', 'failed', 'canceled') AND "completed_at" IS NOT NULL)
    OR ("state" IN ('queued', 'running') AND "completed_at" IS NULL)
  ),
  CONSTRAINT "quality_replay_runs_revision_ck" CHECK (
    "revision" >= 1 AND "attempt" >= 0 AND "permission_snapshot_revision" >= 1
    AND "request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "quality_replay_runs_scope_json_ck"
    CHECK (jsonb_typeof("required_permission_scope") = 'array'),
  CONSTRAINT "quality_replay_runs_snapshot_json_ck"
    CHECK (jsonb_typeof("frozen_snapshot") = 'object'),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  FOREIGN KEY (
    "knowledge_space_id", "permission_snapshot_id", "requested_by_subject_id", "access_channel"
  ) REFERENCES "knowledge_space_permission_snapshots" (
    "knowledge_space_id", "id", "subject_id", "access_channel"
  ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "quality_replay_runs_scope_id_uq"
  ON "quality_replay_runs" ("tenant_id", "knowledge_space_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "quality_replay_runs_idempotency_uq"
  ON "quality_replay_runs" ("tenant_id", "knowledge_space_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "quality_replay_runs_scope_created_idx"
  ON "quality_replay_runs" ("tenant_id", "knowledge_space_id", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "quality_replay_runs_claim_idx"
  ON "quality_replay_runs" ("state", "lease_expires_at", "created_at", "id");

CREATE TABLE IF NOT EXISTS "quality_replay_items" (
  "id" UUID PRIMARY KEY NOT NULL,
  "run_id" UUID NOT NULL,
  "golden_question_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "question" TEXT NOT NULL,
  "expected_evidence_ids" JSONB NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "result" JSONB,
  "trace_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quality_replay_items_state_ck" CHECK (
    "ordinal" >= 1 AND "state" IN ('queued', 'running', 'passed', 'failed', 'canceled')
  ),
  CONSTRAINT "quality_replay_items_expected_json_ck"
    CHECK (jsonb_typeof("expected_evidence_ids") = 'array'),
  CONSTRAINT "quality_replay_items_result_json_ck"
    CHECK ("result" IS NULL OR jsonb_typeof("result") = 'object'),
  FOREIGN KEY ("run_id") REFERENCES "quality_replay_runs" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "quality_replay_items_run_ordinal_uq"
  ON "quality_replay_items" ("run_id", "ordinal");
CREATE UNIQUE INDEX IF NOT EXISTS "quality_replay_items_run_golden_uq"
  ON "quality_replay_items" ("run_id", "golden_question_id");

CREATE TABLE IF NOT EXISTS "quality_replay_outbox" (
  "id" UUID PRIMARY KEY NOT NULL,
  "run_id" UUID NOT NULL,
  "delivery_revision" INTEGER NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "delivery_state" VARCHAR(16) NOT NULL,
  "attempt" INTEGER NOT NULL,
  "lease_owner" VARCHAR(255),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "delivered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quality_replay_outbox_state_ck" CHECK (
    "delivery_revision" >= 1
    AND "delivery_state" IN ('pending', 'claimed', 'delivered') AND "attempt" >= 0
    AND (("delivery_state" = 'claimed' AND "lease_owner" IS NOT NULL
      AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL
      AND "delivered_at" IS NULL)
    OR ("delivery_state" <> 'claimed' AND "lease_owner" IS NULL
      AND "lease_token" IS NULL AND "lease_expires_at" IS NULL))
    AND (("delivery_state" = 'delivered' AND "delivered_at" IS NOT NULL)
      OR ("delivery_state" <> 'delivered' AND "delivered_at" IS NULL))
  ),
  FOREIGN KEY ("run_id") REFERENCES "quality_replay_runs" ("id") ON DELETE CASCADE
);
ALTER TABLE "quality_replay_outbox"
  ADD COLUMN IF NOT EXISTS "delivery_revision" INTEGER;
WITH ranked_delivery AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "run_id" ORDER BY "created_at", "id"
  ) AS "delivery_revision"
  FROM "quality_replay_outbox"
)
UPDATE "quality_replay_outbox" AS outbox
SET "delivery_revision" = ranked_delivery."delivery_revision"
FROM ranked_delivery
WHERE outbox."id" = ranked_delivery."id" AND outbox."delivery_revision" IS NULL;
ALTER TABLE "quality_replay_outbox"
  ALTER COLUMN "delivery_revision" SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_replay_outbox_delivery_revision_ck'
      AND conrelid = 'quality_replay_outbox'::regclass
  ) THEN
    ALTER TABLE "quality_replay_outbox"
      ADD CONSTRAINT "quality_replay_outbox_delivery_revision_ck"
      CHECK ("delivery_revision" >= 1);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "quality_replay_outbox_claim_idx"
  ON "quality_replay_outbox" ("delivery_state", "lease_expires_at", "created_at", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "quality_replay_outbox_run_delivery_uq"
  ON "quality_replay_outbox" ("run_id", "delivery_revision");
CREATE INDEX IF NOT EXISTS "quality_replay_outbox_run_idx"
  ON "quality_replay_outbox" ("run_id", "delivery_state", "id");

CREATE TABLE IF NOT EXISTS "quality_bad_cases" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "trace_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "reason" TEXT NOT NULL,
  "tags" JSONB NOT NULL,
  "replay_run_id" UUID,
  "actor_subject_id" VARCHAR(255) NOT NULL,
  "revision" INTEGER NOT NULL,
  "required_permission_scope" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quality_bad_cases_state_ck" CHECK (
    "status" IN ('open', 'replaying', 'fixed', 'dismissed') AND "revision" >= 1
    AND ("status" <> 'replaying' OR "replay_run_id" IS NOT NULL)
  ),
  CONSTRAINT "quality_bad_cases_tags_json_ck" CHECK (jsonb_typeof("tags") = 'array'),
  CONSTRAINT "quality_bad_cases_scope_json_ck"
    CHECK (jsonb_typeof("required_permission_scope") = 'array'),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "quality_bad_cases_trace_scope_fk"
    FOREIGN KEY ("knowledge_space_id", "trace_id")
    REFERENCES "answer_traces" ("knowledge_space_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id", "knowledge_space_id", "replay_run_id")
    REFERENCES "quality_replay_runs" ("tenant_id", "knowledge_space_id", "id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "quality_bad_cases_scope_status_idx"
  ON "quality_bad_cases" ("tenant_id", "knowledge_space_id", "status", "created_at" DESC, "id" DESC);

CREATE TABLE IF NOT EXISTS "quality_missing_evidence_reviews" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "trace_id" UUID NOT NULL,
  "item_key" VARCHAR(71) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "reason" TEXT,
  "actor_subject_id" VARCHAR(255) NOT NULL,
  "revision" INTEGER NOT NULL,
  "required_permission_scope" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quality_missing_evidence_reviews_state_ck" CHECK (
    "status" IN ('active', 'dismissed') AND "revision" >= 1
    AND "item_key" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "quality_missing_evidence_reviews_scope_json_ck"
    CHECK (jsonb_typeof("required_permission_scope") = 'array'),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "quality_missing_evidence_reviews_trace_scope_fk"
    FOREIGN KEY ("knowledge_space_id", "trace_id")
    REFERENCES "answer_traces" ("knowledge_space_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "quality_missing_reviews_item_uq"
  ON "quality_missing_evidence_reviews" (
    "tenant_id", "knowledge_space_id", "trace_id", "item_key"
  );

CREATE TABLE IF NOT EXISTS "quality_resource_history" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "aggregate_type" VARCHAR(32) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "actor_subject_id" VARCHAR(255) NOT NULL,
  "from_status" VARCHAR(16),
  "to_status" VARCHAR(16) NOT NULL,
  "reason" TEXT,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "quality_resource_history_type_ck" CHECK (
    "aggregate_type" IN ('bad-case', 'missing-evidence') AND "revision" >= 1
  ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "quality_resource_history_revision_uq"
  ON "quality_resource_history" (
    "tenant_id", "knowledge_space_id", "aggregate_type", "aggregate_id", "revision"
  );

-- Golden-question visibility is frozen from referenced evidence. Legacy rows intentionally retain
-- NULL provenance and therefore fail every public tenant/scope read.
ALTER TABLE "golden_questions"
  ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "required_permission_scope" JSONB;

ALTER TABLE "golden_questions"
  DROP CONSTRAINT IF EXISTS "golden_questions_scope_json_ck",
  ADD CONSTRAINT "golden_questions_scope_json_ck" CHECK (
    ("tenant_id" IS NULL AND "required_permission_scope" IS NULL)
    OR ("tenant_id" IS NOT NULL AND "required_permission_scope" IS NOT NULL
      AND jsonb_typeof("required_permission_scope") = 'array')
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'golden_questions_scope_fk'
      AND conrelid = 'golden_questions'::regclass
  ) THEN
    ALTER TABLE "golden_questions"
      ADD CONSTRAINT "golden_questions_scope_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id")
      REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_bad_cases_trace_scope_fk'
      AND conrelid = 'quality_bad_cases'::regclass
  ) THEN
    ALTER TABLE "quality_bad_cases"
      ADD CONSTRAINT "quality_bad_cases_trace_scope_fk"
      FOREIGN KEY ("knowledge_space_id", "trace_id")
      REFERENCES "answer_traces" ("knowledge_space_id", "id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_missing_evidence_reviews_trace_scope_fk'
      AND conrelid = 'quality_missing_evidence_reviews'::regclass
  ) THEN
    ALTER TABLE "quality_missing_evidence_reviews"
      ADD CONSTRAINT "quality_missing_evidence_reviews_trace_scope_fk"
      FOREIGN KEY ("knowledge_space_id", "trace_id")
      REFERENCES "answer_traces" ("knowledge_space_id", "id") ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "golden_questions_space_id_idx";
CREATE INDEX IF NOT EXISTS "golden_questions_space_id_idx"
  ON "golden_questions" ("tenant_id", "knowledge_space_id", "id");
DROP INDEX IF EXISTS "golden_questions_space_created_idx";
CREATE INDEX IF NOT EXISTS "golden_questions_space_created_idx"
  ON "golden_questions" ("tenant_id", "knowledge_space_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "failed_queries_space_created_idx"
  ON "failed_queries" ("knowledge_space_id", "created_at", "id");

-- Legacy failed-query rows deliberately remain provenance-free and are fail-closed by every read.
-- New captures write the complete binding atomically; nullable columns keep the migration online.
ALTER TABLE "failed_queries"
  ADD COLUMN IF NOT EXISTS "tenant_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "requested_by_subject_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "access_channel" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "permission_snapshot_id" UUID,
  ADD COLUMN IF NOT EXISTS "permission_snapshot_revision" INTEGER,
  ADD COLUMN IF NOT EXISTS "required_permission_scope" JSONB,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'failed_queries_permission_binding_ck'
      AND conrelid = 'failed_queries'::regclass
  ) THEN
    ALTER TABLE "failed_queries"
      ADD CONSTRAINT "failed_queries_permission_binding_ck" CHECK (
        ("tenant_id" IS NULL AND "requested_by_subject_id" IS NULL
          AND "access_channel" IS NULL AND "permission_snapshot_id" IS NULL
          AND "permission_snapshot_revision" IS NULL
          AND "required_permission_scope" IS NULL AND "revision" IS NULL)
        OR ("tenant_id" IS NOT NULL AND "requested_by_subject_id" IS NOT NULL
          AND "access_channel" IS NOT NULL
          AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')
          AND "permission_snapshot_id" IS NOT NULL
          AND "permission_snapshot_revision" IS NOT NULL
          AND "permission_snapshot_revision" >= 1
          AND "required_permission_scope" IS NOT NULL
          AND jsonb_typeof("required_permission_scope") = 'array'
          AND "revision" IS NOT NULL AND "revision" >= 1)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'failed_queries_scope_fk'
      AND conrelid = 'failed_queries'::regclass
  ) THEN
    ALTER TABLE "failed_queries"
      ADD CONSTRAINT "failed_queries_scope_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id")
      REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'failed_queries_permission_snapshot_fk'
      AND conrelid = 'failed_queries'::regclass
  ) THEN
    ALTER TABLE "failed_queries"
      ADD CONSTRAINT "failed_queries_permission_snapshot_fk"
      FOREIGN KEY ("tenant_id", "knowledge_space_id", "permission_snapshot_id",
        "requested_by_subject_id", "access_channel")
      REFERENCES "knowledge_space_permission_snapshots"
        ("tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel")
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "failed_queries_subject_created_idx"
  ON "failed_queries" (
    "tenant_id", "knowledge_space_id", "requested_by_subject_id", "created_at", "id"
  );
