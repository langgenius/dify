# Local Stack: pgvector Auto-Enable + Admin BFF Token

## What Changed

- `infra/local/postgres-init/01-enable-pgvector.sql` (new) — runs `CREATE
  EXTENSION IF NOT EXISTS vector;` on a fresh Postgres data volume via
  `/docker-entrypoint-initdb.d`.
- `infra/local/compose.yaml` and `infra/local/compose.middleware.yaml` — mount
  `./postgres-init` into the `postgres` service at
  `/docker-entrypoint-initdb.d:ro`.
- `infra/local/compose.yaml` — the `admin` service now passes
  `KNOWLEDGE_DEV_AUTH_TOKEN: ${KNOWLEDGE_DEV_AUTH_TOKEN:-dev-token}`, matching
  the `api` service default so the Admin server-side BFF can authenticate.
- `infra/local/README.md` — documented the pgvector init script, the explicit
  migration step + manual `CREATE EXTENSION` fallback for pre-existing volumes,
  the Admin container token, and the empty-database first-run behavior
  (create a `workspace`-slug space; Publish readiness needs an upload).

## Why It Changed

Running the full Docker stack left the Admin Console showing Control plane,
Operations diagnostics, and Publish readiness as "Unavailable". Root cause was
two stacked problems:

1. **Database never migrated, and could not be.** Migrations are not run by
   compose, the API Dockerfile entrypoint, or on server startup. Running
   `pnpm local:db:migrate` then failed with `type "vector" does not exist`:
   migration `0001_initial_schema` uses `vector(1536)` + an `hnsw` index, but
   nothing enabled the `pgvector` extension. The `pgvector/pgvector:pg16` image
   ships the extension binaries but does not `CREATE EXTENSION` per database. CI
   never caught this because `pnpm db:migrations:check` is a drift check
   (regenerate SQL + diff), not a live apply against Postgres. The checked-in
   migration must stay deterministic, so the extension is enabled out-of-band in
   the local init script rather than in the migration SQL.
2. **Admin BFF had no auth token.** The `admin` service ran with
   `NODE_ENV=production` and no token env, so `getAdminServerToken()` returned
   `null` and the page bailed out with "Admin API token is not configured"
   before calling the API. `/health` is public (no token, no schema), which is
   why System health stayed green while the token-gated, DB-backed panels did
   not.

## Verification

- Before: `GET /knowledge-spaces` (Bearer dev-token) → 500; DB `\dt` → "Did not
  find any relations"; rendered Admin HTML contained "Admin API token is not
  configured" and 27 "Unavailable" badges.
- Enabled extension on the running DB, then `pnpm local:db:migrate` →
  `{"appliedMigrationIds":["0001_initial_schema"]}`.
- `GET /knowledge-spaces` (Bearer dev-token) → `{"items":[]}` / 200.
- Recreated the Admin container; `docker inspect` confirmed
  `KNOWLEDGE_DEV_AUTH_TOKEN=dev-token`. Rendered Admin HTML: token banner gone,
  Control plane and Operations diagnostics badges → "Live".
- Created a `workspace`-slug knowledge space (201). Rendered Admin HTML: no error
  banner; Control plane = Live, Operations diagnostics = Live. Publish readiness
  remains "No document selected" by design until a document is uploaded.
- `docker compose -f infra/local/compose.yaml --profile apps config` validates.

## Risks / Follow-ups

- The init script only runs on a **fresh** Postgres volume. Existing volumes
  still need the one-time manual `CREATE EXTENSION` documented in the README.
- This fixes the local Docker path only. Non-compose deployments (e.g. managed
  Postgres) must ensure `pgvector` is enabled before migrating; consider making
  the migration runner ensure the extension as a more universal follow-up.
- No automated test asserts the extension prerequisite. The opt-in
  `LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path` against a fresh volume
  would now exercise it end-to-end.
