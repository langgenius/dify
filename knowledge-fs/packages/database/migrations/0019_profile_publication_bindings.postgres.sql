-- Knowledge Platform schema migration
-- Migration id: 0019_profile_publication_bindings
-- Dialect: postgres

-- A model-profile migration builds one immutable projection candidate before activation. This
-- ledger binds that candidate to the exact immutable profile revision that was used for the build.
-- Runtime activation revalidates the digest/vector-space and advances both heads in one transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_revisions_attempt_fk_uq"
  ON "knowledge_space_profile_revisions" (
    "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
  );

-- Nullable pairs keep the migration compatible with in-flight attempts created by legacy writers.
-- New writers populate both exact snapshots when the attempt is created and revalidate them before
-- publication. The fixed kind columns let the composite foreign keys prove that an embedding
-- snapshot cannot be substituted for a retrieval snapshot (or vice versa).
ALTER TABLE "document_compilation_attempts"
  ADD COLUMN IF NOT EXISTS "embedding_profile_kind" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "embedding_profile_revision_id" UUID,
  ADD COLUMN IF NOT EXISTS "embedding_profile_revision" INTEGER,
  ADD COLUMN IF NOT EXISTS "embedding_profile_snapshot_digest" CHAR(64),
  ADD COLUMN IF NOT EXISTS "retrieval_profile_kind" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "retrieval_profile_revision_id" UUID,
  ADD COLUMN IF NOT EXISTS "retrieval_profile_revision" INTEGER,
  ADD COLUMN IF NOT EXISTS "retrieval_profile_snapshot_digest" CHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_compilation_attempts_embedding_profile_ck' AND "conrelid" = 'document_compilation_attempts'::regclass) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_embedding_profile_ck" CHECK (
        ("embedding_profile_kind" IS NULL AND "embedding_profile_revision_id" IS NULL AND "embedding_profile_revision" IS NULL AND "embedding_profile_snapshot_digest" IS NULL)
        OR ("embedding_profile_kind" = 'embedding' AND "embedding_profile_revision_id" IS NOT NULL AND "embedding_profile_revision" >= 1 AND "embedding_profile_snapshot_digest" IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_compilation_attempts_retrieval_profile_ck' AND "conrelid" = 'document_compilation_attempts'::regclass) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_retrieval_profile_ck" CHECK (
        ("retrieval_profile_kind" IS NULL AND "retrieval_profile_revision_id" IS NULL AND "retrieval_profile_revision" IS NULL AND "retrieval_profile_snapshot_digest" IS NULL)
        OR ("retrieval_profile_kind" = 'retrieval' AND "retrieval_profile_revision_id" IS NOT NULL AND "retrieval_profile_revision" >= 1 AND "retrieval_profile_snapshot_digest" IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_compilation_attempts_profile_tuple_ck' AND "conrelid" = 'document_compilation_attempts'::regclass) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_profile_tuple_ck" CHECK (
        (
          "embedding_profile_kind" IS NULL
          AND "embedding_profile_revision_id" IS NULL
          AND "embedding_profile_revision" IS NULL
          AND "embedding_profile_snapshot_digest" IS NULL
          AND "retrieval_profile_kind" IS NULL
          AND "retrieval_profile_revision_id" IS NULL
          AND "retrieval_profile_revision" IS NULL
          AND "retrieval_profile_snapshot_digest" IS NULL
        )
        OR (
          "retrieval_profile_kind" = 'retrieval'
          AND "retrieval_profile_revision_id" IS NOT NULL
          AND "retrieval_profile_revision" >= 1
          AND "retrieval_profile_snapshot_digest" IS NOT NULL
          AND (
            (
              "embedding_profile_kind" IS NULL
              AND "embedding_profile_revision_id" IS NULL
              AND "embedding_profile_revision" IS NULL
              AND "embedding_profile_snapshot_digest" IS NULL
            )
            OR (
              "embedding_profile_kind" = 'embedding'
              AND "embedding_profile_revision_id" IS NOT NULL
              AND "embedding_profile_revision" >= 1
              AND "embedding_profile_snapshot_digest" IS NOT NULL
            )
          )
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_compilation_attempts_embedding_profile_fk' AND "conrelid" = 'document_compilation_attempts'::regclass) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_embedding_profile_fk" FOREIGN KEY (
        "tenant_id", "knowledge_space_id", "embedding_profile_kind", "embedding_profile_revision_id", "embedding_profile_revision", "embedding_profile_snapshot_digest"
      ) REFERENCES "knowledge_space_profile_revisions" (
        "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
      ) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'document_compilation_attempts_retrieval_profile_fk' AND "conrelid" = 'document_compilation_attempts'::regclass) THEN
    ALTER TABLE "document_compilation_attempts"
      ADD CONSTRAINT "document_compilation_attempts_retrieval_profile_fk" FOREIGN KEY (
        "tenant_id", "knowledge_space_id", "retrieval_profile_kind", "retrieval_profile_revision_id", "retrieval_profile_revision", "retrieval_profile_snapshot_digest"
      ) REFERENCES "knowledge_space_profile_revisions" (
        "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
      ) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "knowledge_space_profile_publication_bindings" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "changed_kind" VARCHAR(16) NOT NULL,
  "binding_reason" VARCHAR(24) NOT NULL,
  "embedding_profile_kind" VARCHAR(16),
  "embedding_profile_revision_id" UUID,
  "embedding_profile_revision" INTEGER,
  "embedding_profile_snapshot_digest" CHAR(64),
  "retrieval_profile_kind" VARCHAR(16) NOT NULL,
  "retrieval_profile_revision_id" UUID NOT NULL,
  "retrieval_profile_revision" INTEGER NOT NULL,
  "retrieval_profile_snapshot_digest" CHAR(64) NOT NULL,
  "vector_space_id" VARCHAR(87),
  "publication_id" UUID NOT NULL,
  "publication_fingerprint" VARCHAR(86) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "activated_at" TIMESTAMPTZ,
  CONSTRAINT "knowledge_space_profile_publication_bindings_kind_ck"
    CHECK (
      "changed_kind" IN ('embedding', 'retrieval', 'bootstrap', 'content')
      AND "retrieval_profile_kind" = 'retrieval'
      AND ("embedding_profile_kind" IS NULL OR "embedding_profile_kind" = 'embedding')
    ),
  CONSTRAINT "knowledge_space_profile_publication_bindings_reason_ck"
    CHECK (
      ("binding_reason" = 'candidate-switch' AND "changed_kind" IN ('embedding', 'retrieval'))
      OR ("binding_reason" = 'legacy-bootstrap' AND "changed_kind" = 'bootstrap')
      OR ("binding_reason" = 'content-publication' AND "changed_kind" = 'content')
    ),
  CONSTRAINT "knowledge_space_profile_publication_bindings_shape_ck"
    CHECK (
      "retrieval_profile_revision" >= 1
      AND (
        (
          "embedding_profile_kind" IS NULL
          AND "embedding_profile_revision_id" IS NULL
          AND "embedding_profile_revision" IS NULL
          AND "embedding_profile_snapshot_digest" IS NULL
          AND "vector_space_id" IS NULL
          AND "changed_kind" IN ('retrieval', 'bootstrap', 'content')
        )
        OR (
          "embedding_profile_kind" = 'embedding'
          AND "embedding_profile_revision_id" IS NOT NULL
          AND "embedding_profile_revision" >= 1
          AND "embedding_profile_snapshot_digest" IS NOT NULL
          AND "vector_space_id" IS NOT NULL
        )
      )
      AND (
        "binding_reason" = 'candidate-switch'
        OR ("binding_reason" IN ('legacy-bootstrap', 'content-publication') AND "activated_at" IS NOT NULL)
      )
    ),
  FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "embedding_profile_kind",
    "embedding_profile_revision_id", "embedding_profile_revision",
    "embedding_profile_snapshot_digest"
  ) REFERENCES "knowledge_space_profile_revisions" (
    "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "retrieval_profile_kind",
    "retrieval_profile_revision_id", "retrieval_profile_revision",
    "retrieval_profile_snapshot_digest"
  ) REFERENCES "knowledge_space_profile_revisions" (
    "tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    "tenant_id", "knowledge_space_id", "publication_id", "publication_fingerprint"
  ) REFERENCES "projection_set_publications" (
    "tenant_id", "knowledge_space_id", "id", "fingerprint"
  ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_profile_publication_bindings_publication_uq"
  ON "knowledge_space_profile_publication_bindings" (
    "tenant_id", "knowledge_space_id", "publication_id"
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_profile_publication_bindings_activation_idx"
  ON "knowledge_space_profile_publication_bindings" (
    "tenant_id", "knowledge_space_id", "activated_at",
    "embedding_profile_revision", "retrieval_profile_revision", "publication_id"
  );
