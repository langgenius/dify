-- Knowledge Platform schema migration
-- Migration id: 0050_deletion_job_capability_provenance
-- Dialect: tidb
-- A space deletion job outlives the space-owned grant that authorized it. Preserve the grant id
-- as immutable audit provenance without a live FK that blocks the terminal space delete.

ALTER TABLE `deletion_jobs`
  DROP FOREIGN KEY `deletion_jobs_capability_grant_fk`;

ALTER TABLE `deletion_retry_audits`
  DROP FOREIGN KEY `deletion_retry_audits_capability_grant_fk`;
