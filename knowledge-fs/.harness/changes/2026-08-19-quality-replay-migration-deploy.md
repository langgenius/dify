# Apply KnowledgeFS migrations during deployment

Date: 2026-08-19

## What changed

- The KnowledgeFS deployment workflow now runs the migration entrypoint from the exact deployed
  API container after the deployment script completes.
- Deployment fails closed unless exactly one running Compose `knowledge_fs` service container is
  present.
- Workflow regression coverage locks the container discovery and migration command contract.

## Why

The API image containing quality replay match-policy support was deployed while the database
remained at migration `0044`. Replay history then attempted to read the missing `match_policy`
column and the handler reduced that internal mapping failure to a generic invalid-request response.
The replay runs existed and had completed, but the Quality page could not list them.

## Verification

- Applied `0045_quality_replay_match_policy` to the test environment and verified both historical
  replay items were backfilled with `match_policy = 'all'`.
- Refreshed the deployed Quality evaluation page and verified both completed replay runs are
  visible with their reports.
- KnowledgeFS GitHub Actions workflow tests pass.
