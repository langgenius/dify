-- Runs automatically on a fresh Postgres data volume (docker-entrypoint-initdb.d).
-- The checked-in migration 0001_initial_schema uses the `vector` type and an
-- hnsw index, but does not (and must not, to stay deterministic) create the
-- extension itself. Enable it here so `pnpm local:db:migrate` succeeds against a
-- brand-new local database without a manual step.
CREATE EXTENSION IF NOT EXISTS vector;
