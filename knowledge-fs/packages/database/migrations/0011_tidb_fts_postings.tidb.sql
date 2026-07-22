-- Knowledge Platform schema migration
-- Migration id: 0011_tidb_fts_postings
-- Dialect: tidb

-- TiDB v8.5 has no executable FULLTEXT index. Store deterministic, projection-scoped postings
-- instead of scanning index_projections.fts_document with INSTR/LIKE.
-- TiDB v8.5 does not support ADD CONSTRAINT IF NOT EXISTS. The migration runner records its
-- ledger row after executing this artifact, so a process failure between those operations must be
-- safely replayable.
SET @projection_publication_status_constraint_exists = (
  SELECT COUNT(*)
  FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'projection_set_publications'
    AND constraint_name = 'projection_set_publications_status_ck'
);
SET @projection_publication_status_constraint_ddl = IF(
  @projection_publication_status_constraint_exists = 0,
  'ALTER TABLE `projection_set_publications` ADD CONSTRAINT `projection_set_publications_status_ck` CHECK (`status` IN (''candidate'', ''inactive'', ''published'', ''superseded'', ''validating''))',
  'DO 0'
);
PREPARE projection_publication_status_constraint_statement
  FROM @projection_publication_status_constraint_ddl;
EXECUTE projection_publication_status_constraint_statement;
DEALLOCATE PREPARE projection_publication_status_constraint_statement;

CREATE UNIQUE INDEX IF NOT EXISTS `index_projections_space_id_uq`
  ON `index_projections` (`knowledge_space_id`, `id`);
CREATE INDEX IF NOT EXISTS `index_projections_fts_backfill_idx`
  ON `index_projections` (`knowledge_space_id`, `id`);

CREATE TABLE IF NOT EXISTS `index_projection_fts_postings` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `projection_id` CHAR(36) NOT NULL,
  `tokenizer_version` VARCHAR(64) NOT NULL,
  `term_hash` CHAR(64) NOT NULL,
  `term` VARCHAR(128) NOT NULL,
  `term_frequency` INT NOT NULL,
  `document_token_count` INT NOT NULL,
  CONSTRAINT `index_projection_fts_postings_frequency_ck`
    CHECK (`term_frequency` > 0 AND `document_token_count` >= `term_frequency`),
  FOREIGN KEY (`knowledge_space_id`) REFERENCES `knowledge_spaces` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`knowledge_space_id`, `projection_id`)
    REFERENCES `index_projections` (`knowledge_space_id`, `id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `index_projection_fts_postings_projection_term_uq`
  ON `index_projection_fts_postings` (`projection_id`, `tokenizer_version`, `term_hash`);
CREATE INDEX IF NOT EXISTS `index_projection_fts_postings_lookup_idx`
  ON `index_projection_fts_postings` (`knowledge_space_id`, `term_hash`, `projection_id`);

-- Do not run an unbounded recursive backfill inside the migration transaction. The API runtime
-- discovers old spaces and advances this fenced cursor one immutable projection at a time after
-- the transactional dual writer is live.
CREATE TABLE IF NOT EXISTS `tidb_fts_posting_backfills` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `tokenizer_version` VARCHAR(64) NOT NULL,
  `run_state` VARCHAR(16) NOT NULL,
  `cursor_projection_id` CHAR(36),
  `scanned_projections` INT NOT NULL,
  `written_postings` INT NOT NULL,
  `worker_id` VARCHAR(255),
  `lease_token` CHAR(36),
  `lease_expires_at` DATETIME(3),
  `heartbeat_at` DATETIME(3),
  `retry_count` INT NOT NULL,
  `row_version` INT NOT NULL,
  `last_error_code` VARCHAR(64),
  `last_error_message` TEXT,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `completed_at` DATETIME(3),
  CONSTRAINT `tidb_fts_posting_backfills_state_ck`
    CHECK (`run_state` IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT `tidb_fts_posting_backfills_counts_ck`
    CHECK (
      `scanned_projections` >= 0
      AND `written_postings` >= 0
      AND `retry_count` >= 0
      AND `row_version` >= 0
    ),
  CONSTRAINT `tidb_fts_posting_backfills_lease_ck`
    CHECK (
      (
        `run_state` = 'running'
        AND `worker_id` IS NOT NULL
        AND `lease_token` IS NOT NULL
        AND `lease_expires_at` IS NOT NULL
        AND `heartbeat_at` IS NOT NULL
        AND `completed_at` IS NULL
      )
      OR (
        `run_state` <> 'running'
        AND `worker_id` IS NULL
        AND `lease_token` IS NULL
        AND `lease_expires_at` IS NULL
        AND `heartbeat_at` IS NULL
      )
    ),
  CONSTRAINT `tidb_fts_posting_backfills_terminal_ck`
    CHECK (
      (`run_state` IN ('succeeded', 'failed') AND `completed_at` IS NOT NULL)
      OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL)
    ),
  CONSTRAINT `tidb_fts_posting_backfills_lease_token_ck`
    CHECK (
      `lease_token` IS NULL
      OR `lease_token` <> '00000000-0000-0000-0000-000000000000'
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `tidb_fts_posting_backfills_space_tokenizer_uq`
  ON `tidb_fts_posting_backfills` (
    `tenant_id`, `knowledge_space_id`, `tokenizer_version`
  );
CREATE INDEX IF NOT EXISTS `tidb_fts_posting_backfills_claim_idx`
  ON `tidb_fts_posting_backfills` (
    `run_state`, `lease_expires_at`, `updated_at`, `id`
  );
CREATE INDEX IF NOT EXISTS `tidb_fts_posting_backfills_scope_idx`
  ON `tidb_fts_posting_backfills` (
    `tenant_id`, `knowledge_space_id`, `tokenizer_version`, `id`
  );
