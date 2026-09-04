-- Knowledge Platform schema migration
-- Migration id: 0052_namespace_source_previews
-- Dialect: tidb

CREATE TABLE IF NOT EXISTS `namespace_source_preview_jobs` (
  `id` char(36) PRIMARY KEY,
  `tenant_id` varchar(255) NOT NULL,
  `account_id` varchar(255) NOT NULL,
  `status` varchar(32) NOT NULL,
  `provider_config` json NOT NULL,
  `configuration_fingerprint` varchar(128) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `consumed_at` datetime(6) NULL,
  `content_cleaned_at` datetime(6) NULL,
  `import_workflow_id` char(36) NULL,
  `error_code` varchar(128) NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  INDEX `namespace_source_preview_jobs_claim_idx` (`status`, `expires_at`, `created_at`),
  INDEX `namespace_source_preview_jobs_owner_idx` (`tenant_id`, `account_id`, `created_at`),
  INDEX `namespace_source_preview_jobs_cleanup_idx` (`status`, `content_cleaned_at`, `updated_at`)
);

CREATE TABLE IF NOT EXISTS `namespace_source_preview_pages` (
  `job_id` char(36) NOT NULL,
  `page_id` varchar(128) NOT NULL,
  `source_url` varchar(4096) NOT NULL,
  `title` varchar(500) NULL,
  `description` text NULL,
  `content_hash` varchar(64) NOT NULL,
  `content_object_key` varchar(2048) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`job_id`, `page_id`),
  CONSTRAINT `namespace_source_preview_pages_job_fk` FOREIGN KEY (`job_id`) REFERENCES `namespace_source_preview_jobs` (`id`) ON DELETE CASCADE
);
