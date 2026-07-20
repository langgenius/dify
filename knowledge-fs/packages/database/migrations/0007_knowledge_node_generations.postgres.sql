-- Knowledge Platform schema migration
-- Migration id: 0007_knowledge_node_generations
-- Dialect: postgres

-- Knowledge nodes are immutable-build components. NULL remains the legacy publication scope;
-- non-NULL generations can be built and evaluated without mutating currently readable nodes.
ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "publication_generation_id" UUID;

-- A durable attempt cannot claim that a candidate projection snapshot exists until the candidate
-- publication identity has been atomically bound to the attempt.
ALTER TABLE "document_compilation_attempts"
  ADD CONSTRAINT "document_compilation_attempts_candidate_checkpoint_ck"
  CHECK (
    "checkpoint" NOT IN ('projection_built', 'smoke_eval_passed', 'published')
    OR (
      "candidate_publication_id" IS NOT NULL
      AND "candidate_fingerprint" IS NOT NULL
    )
  );

-- The zero UUID is reserved only for mapping legacy NULL into the logical unique index. Adding the
-- constraint before enabling generation writers fails closed if historical data violates it.
ALTER TABLE "knowledge_nodes"
  ADD CONSTRAINT "knowledge_nodes_pub_gen_nonzero_ck"
  CHECK (
    "publication_generation_id" IS NULL
    OR "publication_generation_id" <> '00000000-0000-0000-0000-000000000000'::uuid
  );

-- Retained generations must not amplify the two high-frequency node walks.
DROP INDEX IF EXISTS "knowledge_nodes_space_asset_kind_idx";
CREATE INDEX IF NOT EXISTS "knowledge_nodes_space_asset_kind_idx"
  ON "knowledge_nodes" (
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "kind",
    "id"
  );

DROP INDEX IF EXISTS "knowledge_nodes_artifact_offset_idx";
CREATE INDEX IF NOT EXISTS "knowledge_nodes_artifact_offset_idx"
  ON "knowledge_nodes" (
    "knowledge_space_id",
    "parse_artifact_id",
    "publication_generation_id",
    "start_offset",
    "id"
  );

-- Do not delete or arbitrarily merge historical duplicates. Unique-index creation intentionally
-- aborts the migration so an operator can reconcile evidence-preserving node identity explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_nodes_artifact_kind_offsets_uq"
  ON "knowledge_nodes" (
    "knowledge_space_id",
    "parse_artifact_id",
    "kind",
    "start_offset",
    "end_offset",
    (COALESCE("publication_generation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );
