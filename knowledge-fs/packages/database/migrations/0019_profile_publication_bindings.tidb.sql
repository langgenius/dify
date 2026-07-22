-- Knowledge Platform schema migration
-- Migration id: 0019_profile_publication_bindings
-- Dialect: tidb

-- Candidate-to-profile identity is persisted before the candidate is built. The activation
-- transaction revalidates this immutable binding before changing either mutable head.
CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_profile_revisions_attempt_fk_uq`
  ON `knowledge_space_profile_revisions` (
    `tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`, `snapshot_digest`
  );

-- Legacy attempts may leave these columns NULL during the rolling upgrade. New writers persist
-- both exact profile snapshots at attempt creation. Fixed kind columns participate in the foreign
-- keys so embedding and retrieval snapshots cannot be swapped accidentally.
ALTER TABLE `document_compilation_attempts`
  ADD COLUMN IF NOT EXISTS `embedding_profile_kind` VARCHAR(16),
  ADD COLUMN IF NOT EXISTS `embedding_profile_revision_id` CHAR(36),
  ADD COLUMN IF NOT EXISTS `embedding_profile_revision` INT,
  ADD COLUMN IF NOT EXISTS `embedding_profile_snapshot_digest` CHAR(64),
  ADD COLUMN IF NOT EXISTS `retrieval_profile_kind` VARCHAR(16),
  ADD COLUMN IF NOT EXISTS `retrieval_profile_revision_id` CHAR(36),
  ADD COLUMN IF NOT EXISTS `retrieval_profile_revision` INT,
  ADD COLUMN IF NOT EXISTS `retrieval_profile_snapshot_digest` CHAR(64);

SET @attempt_embedding_profile_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'document_compilation_attempts'
    AND constraint_name = 'document_compilation_attempts_embedding_profile_ck'
);
SET @attempt_embedding_profile_ck_ddl = IF(
  @attempt_embedding_profile_ck_exists = 0,
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_embedding_profile_ck` CHECK ((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL) OR (`embedding_profile_kind` = ''embedding'' AND `embedding_profile_revision_id` IS NOT NULL AND `embedding_profile_revision` >= 1 AND `embedding_profile_snapshot_digest` IS NOT NULL))',
  'DO 0'
);
PREPARE attempt_embedding_profile_ck_statement FROM @attempt_embedding_profile_ck_ddl;
EXECUTE attempt_embedding_profile_ck_statement;
DEALLOCATE PREPARE attempt_embedding_profile_ck_statement;

SET @attempt_retrieval_profile_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'document_compilation_attempts'
    AND constraint_name = 'document_compilation_attempts_retrieval_profile_ck'
);
SET @attempt_retrieval_profile_ck_ddl = IF(
  @attempt_retrieval_profile_ck_exists = 0,
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_retrieval_profile_ck` CHECK ((`retrieval_profile_kind` IS NULL AND `retrieval_profile_revision_id` IS NULL AND `retrieval_profile_revision` IS NULL AND `retrieval_profile_snapshot_digest` IS NULL) OR (`retrieval_profile_kind` = ''retrieval'' AND `retrieval_profile_revision_id` IS NOT NULL AND `retrieval_profile_revision` >= 1 AND `retrieval_profile_snapshot_digest` IS NOT NULL))',
  'DO 0'
);
PREPARE attempt_retrieval_profile_ck_statement FROM @attempt_retrieval_profile_ck_ddl;
EXECUTE attempt_retrieval_profile_ck_statement;
DEALLOCATE PREPARE attempt_retrieval_profile_ck_statement;

SET @attempt_profile_tuple_ck_exists = (
  SELECT COUNT(*) FROM information_schema.tidb_check_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'document_compilation_attempts'
    AND constraint_name = 'document_compilation_attempts_profile_tuple_ck'
);
SET @attempt_profile_tuple_ck_ddl = IF(
  @attempt_profile_tuple_ck_exists = 0,
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_profile_tuple_ck` CHECK (((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL AND `retrieval_profile_kind` IS NULL AND `retrieval_profile_revision_id` IS NULL AND `retrieval_profile_revision` IS NULL AND `retrieval_profile_snapshot_digest` IS NULL) OR (`retrieval_profile_kind` = ''retrieval'' AND `retrieval_profile_revision_id` IS NOT NULL AND `retrieval_profile_revision` >= 1 AND `retrieval_profile_snapshot_digest` IS NOT NULL AND ((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL) OR (`embedding_profile_kind` = ''embedding'' AND `embedding_profile_revision_id` IS NOT NULL AND `embedding_profile_revision` >= 1 AND `embedding_profile_snapshot_digest` IS NOT NULL)))))',
  'DO 0'
);
PREPARE attempt_profile_tuple_ck_statement FROM @attempt_profile_tuple_ck_ddl;
EXECUTE attempt_profile_tuple_ck_statement;
DEALLOCATE PREPARE attempt_profile_tuple_ck_statement;

SET @attempt_embedding_profile_fk_exists = (
  SELECT COUNT(*) FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'document_compilation_attempts'
    AND constraint_name = 'document_compilation_attempts_embedding_profile_fk'
);
SET @attempt_embedding_profile_fk_ddl = IF(
  @attempt_embedding_profile_fk_exists = 0,
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_embedding_profile_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `embedding_profile_kind`, `embedding_profile_revision_id`, `embedding_profile_revision`, `embedding_profile_snapshot_digest`) REFERENCES `knowledge_space_profile_revisions` (`tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`, `snapshot_digest`)',
  'DO 0'
);
PREPARE attempt_embedding_profile_fk_statement FROM @attempt_embedding_profile_fk_ddl;
EXECUTE attempt_embedding_profile_fk_statement;
DEALLOCATE PREPARE attempt_embedding_profile_fk_statement;

SET @attempt_retrieval_profile_fk_exists = (
  SELECT COUNT(*) FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'document_compilation_attempts'
    AND constraint_name = 'document_compilation_attempts_retrieval_profile_fk'
);
SET @attempt_retrieval_profile_fk_ddl = IF(
  @attempt_retrieval_profile_fk_exists = 0,
  'ALTER TABLE `document_compilation_attempts` ADD CONSTRAINT `document_compilation_attempts_retrieval_profile_fk` FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `retrieval_profile_kind`, `retrieval_profile_revision_id`, `retrieval_profile_revision`, `retrieval_profile_snapshot_digest`) REFERENCES `knowledge_space_profile_revisions` (`tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`, `snapshot_digest`)',
  'DO 0'
);
PREPARE attempt_retrieval_profile_fk_statement FROM @attempt_retrieval_profile_fk_ddl;
EXECUTE attempt_retrieval_profile_fk_statement;
DEALLOCATE PREPARE attempt_retrieval_profile_fk_statement;

CREATE TABLE IF NOT EXISTS `knowledge_space_profile_publication_bindings` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `changed_kind` VARCHAR(16) NOT NULL,
  `binding_reason` VARCHAR(24) NOT NULL,
  `embedding_profile_kind` VARCHAR(16),
  `embedding_profile_revision_id` CHAR(36),
  `embedding_profile_revision` INT,
  `embedding_profile_snapshot_digest` CHAR(64),
  `retrieval_profile_kind` VARCHAR(16) NOT NULL,
  `retrieval_profile_revision_id` CHAR(36) NOT NULL,
  `retrieval_profile_revision` INT NOT NULL,
  `retrieval_profile_snapshot_digest` CHAR(64) NOT NULL,
  `vector_space_id` VARCHAR(87),
  `publication_id` CHAR(36) NOT NULL,
  `publication_fingerprint` VARCHAR(86) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `activated_at` DATETIME(3),
  CONSTRAINT `knowledge_space_profile_publication_bindings_kind_ck`
    CHECK (
      `changed_kind` IN ('embedding', 'retrieval', 'bootstrap', 'content')
      AND `retrieval_profile_kind` = 'retrieval'
      AND (`embedding_profile_kind` IS NULL OR `embedding_profile_kind` = 'embedding')
    ),
  CONSTRAINT `knowledge_space_profile_publication_bindings_reason_ck`
    CHECK (
      (`binding_reason` = 'candidate-switch' AND `changed_kind` IN ('embedding', 'retrieval'))
      OR (`binding_reason` = 'legacy-bootstrap' AND `changed_kind` = 'bootstrap')
      OR (`binding_reason` = 'content-publication' AND `changed_kind` = 'content')
    ),
  CONSTRAINT `knowledge_space_profile_publication_bindings_shape_ck`
    CHECK (
      `retrieval_profile_revision` >= 1
      AND (
        (
          `embedding_profile_kind` IS NULL
          AND `embedding_profile_revision_id` IS NULL
          AND `embedding_profile_revision` IS NULL
          AND `embedding_profile_snapshot_digest` IS NULL
          AND `vector_space_id` IS NULL
          AND `changed_kind` IN ('retrieval', 'bootstrap', 'content')
        )
        OR (
          `embedding_profile_kind` = 'embedding'
          AND `embedding_profile_revision_id` IS NOT NULL
          AND `embedding_profile_revision` >= 1
          AND `embedding_profile_snapshot_digest` IS NOT NULL
          AND `vector_space_id` IS NOT NULL
        )
      )
      AND (
        `binding_reason` = 'candidate-switch'
        OR (`binding_reason` IN ('legacy-bootstrap', 'content-publication') AND `activated_at` IS NOT NULL)
      )
    ),
  FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  -- TiDB's omitted referential action is RESTRICT. It is deliberately omitted because explicit
  -- RESTRICT makes these CHECK-constrained child columns ineligible on supported TiDB versions.
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `embedding_profile_kind`,
    `embedding_profile_revision_id`, `embedding_profile_revision`,
    `embedding_profile_snapshot_digest`
  ) REFERENCES `knowledge_space_profile_revisions` (
    `tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`, `snapshot_digest`
  ),
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `retrieval_profile_kind`,
    `retrieval_profile_revision_id`, `retrieval_profile_revision`,
    `retrieval_profile_snapshot_digest`
  ) REFERENCES `knowledge_space_profile_revisions` (
    `tenant_id`, `knowledge_space_id`, `kind`, `id`, `revision`, `snapshot_digest`
  ),
  FOREIGN KEY (
    `tenant_id`, `knowledge_space_id`, `publication_id`, `publication_fingerprint`
  ) REFERENCES `projection_set_publications` (
    `tenant_id`, `knowledge_space_id`, `id`, `fingerprint`
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS `knowledge_space_profile_publication_bindings_publication_uq`
  ON `knowledge_space_profile_publication_bindings` (
    `tenant_id`, `knowledge_space_id`, `publication_id`
  );
CREATE INDEX IF NOT EXISTS `knowledge_space_profile_publication_bindings_activation_idx`
  ON `knowledge_space_profile_publication_bindings` (
    `tenant_id`, `knowledge_space_id`, `activated_at`,
    `embedding_profile_revision`, `retrieval_profile_revision`, `publication_id`
  );
