-- Reset Dify to the first-run /install wizard (clears logins and workspace data).
-- Run in Render Dashboard: dify-db -> Connect -> PSQL
-- Order matters: tenants CASCADE removes apps/datasets tied to the workspace.

TRUNCATE tenants CASCADE;
TRUNCATE dify_setups;

-- Verify (should return 0 for both):
-- SELECT COUNT(*) FROM dify_setups;
-- SELECT COUNT(*) FROM tenants;
