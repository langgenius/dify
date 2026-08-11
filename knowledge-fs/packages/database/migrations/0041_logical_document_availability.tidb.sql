-- Knowledge Platform schema migration
-- Migration id: 0041_logical_document_availability
-- Dialect: tidb
-- Adds document-scoped availability without mutating source or physical index state.

ALTER TABLE `logical_documents`
  ADD COLUMN IF NOT EXISTS `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS `disabled_at` TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS `disabled_by_subject_id` VARCHAR(255) NULL;

ALTER TABLE `logical_documents`
  ADD CONSTRAINT `logical_documents_availability_ck`
  CHECK (
    (`enabled` AND `disabled_at` IS NULL AND `disabled_by_subject_id` IS NULL)
    OR (NOT `enabled` AND `disabled_at` IS NOT NULL AND `disabled_by_subject_id` IS NOT NULL)
  );
