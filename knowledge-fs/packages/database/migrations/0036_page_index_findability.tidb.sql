-- Knowledge Platform schema migration
-- Migration id: 0036_page_index_findability
-- Dialect: tidb
-- Persists generation-scoped PageIndex navigation quality and a bounded summary-repair request.

CREATE TABLE IF NOT EXISTS `page_index_findability_evaluations` (
  `id` CHAR(36) PRIMARY KEY NOT NULL,
  `tenant_id` VARCHAR(255) NOT NULL,
  `knowledge_space_id` CHAR(36) NOT NULL,
  `document_asset_id` CHAR(36) NOT NULL,
  `document_version` BIGINT NOT NULL,
  `outline_id` CHAR(36) NOT NULL,
  `publication_generation_id` CHAR(36) NOT NULL,
  `publication_fingerprint` VARCHAR(96) NOT NULL,
  `compilation_attempt_id` CHAR(36) NOT NULL,
  `evaluator_version` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `recommended_route` VARCHAR(16) NOT NULL,
  `evaluation` JSON NOT NULL,
  `summary_repair_state` VARCHAR(24) NOT NULL,
  `summary_repair_attempts` INT NOT NULL DEFAULT 0,
  `summary_repair_error` VARCHAR(2000),
  `available_at` DATETIME(3),
  `lock_token` CHAR(36),
  `locked_by` VARCHAR(255),
  `lease_expires_at` DATETIME(3),
  `evaluated_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  CONSTRAINT `page_index_findability_scope_fk`
    FOREIGN KEY (`tenant_id`, `knowledge_space_id`)
    REFERENCES `knowledge_spaces` (`tenant_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `page_index_findability_status_ck`
    CHECK (`status` IN ('failed', 'not-evaluated', 'passed')),
  CONSTRAINT `page_index_findability_route_ck`
    CHECK (`recommended_route` IN ('hybrid', 'layered', 'unchanged')),
  CONSTRAINT `page_index_findability_repair_ck`
    CHECK (
      `summary_repair_state` IN ('not-requested', 'queued', 'leased', 'dispatched', 'failed')
      AND `summary_repair_attempts` >= 0
      AND (
        (`summary_repair_state` = 'leased'
          AND `lock_token` IS NOT NULL
          AND `locked_by` IS NOT NULL
          AND `lease_expires_at` IS NOT NULL)
        OR
        (`summary_repair_state` <> 'leased'
          AND `lock_token` IS NULL
          AND `locked_by` IS NULL
          AND `lease_expires_at` IS NULL)
      )
    ),
  CONSTRAINT `page_index_findability_evaluation_ck`
    CHECK (JSON_TYPE(`evaluation`) = 'OBJECT'),
  CONSTRAINT `page_index_findability_document_version_ck`
    CHECK (`document_version` >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS `page_index_findability_generation_evaluator_uq`
  ON `page_index_findability_evaluations` (
    `tenant_id`, `knowledge_space_id`, `publication_generation_id`, `evaluator_version`
  );
CREATE INDEX IF NOT EXISTS `page_index_findability_route_idx`
  ON `page_index_findability_evaluations` (
    `tenant_id`, `knowledge_space_id`, `document_asset_id`, `publication_generation_id`
  );
CREATE INDEX IF NOT EXISTS `page_index_findability_repair_queue_idx`
  ON `page_index_findability_evaluations` (
    `summary_repair_state`, `available_at`, `lease_expires_at`, `updated_at`, `id`
  );
