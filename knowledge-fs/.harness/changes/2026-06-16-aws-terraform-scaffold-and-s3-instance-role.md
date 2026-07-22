# AWS Terraform scaffold + S3 IAM instance-role support

## What Changed

- Added `aws_terraform/README.md` — the target AWS architecture diagram for the
  Standalone deployment (EC2 running `api` + `unstructured`, Aurora Serverless v2
  PostgreSQL + pgvector, AWS S3 for object storage). Diagram and component/env
  mapping only; **no Terraform code or runbook yet** (tracked in the doc's Status
  checklist).
- Documented the EC2 metadata options required for containerized IMDSv2
  credential delivery (`http_put_response_hop_limit = 2`) so the API container
  can use the instance role for S3.
- Extended the Node object-storage adapter (`packages/adapters/src/node.ts`) to
  support AWS IAM instance-role / default-credential-chain authentication:
  - New exported helper `buildNodeS3ClientConfig(env, endpoint)` that returns the
    `S3ClientConfig`. It includes static `credentials` **only when both**
    `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` are set; otherwise it omits them so
    the AWS SDK resolves credentials via its default provider chain (EC2 instance
    role, ECS task role, `AWS_*` env, etc.).
  - `createNodeObjectStorageAdapter` now selects S3-compatible storage when
    `MINIO_BUCKET` **and** `MINIO_ENDPOINT` are present (credentials optional),
    instead of requiring all four of bucket/endpoint/access-key/secret.

## Why It Changed

The agreed AWS topology runs the API on EC2 and authenticates to S3 through an
IAM instance role, which is the recommended AWS pattern (no long-lived access
keys to inject or rotate). The previous adapter hard-required
`MINIO_ACCESS_KEY` + `MINIO_SECRET_KEY`, so an instance-role deployment would
silently fall back to bounded in-memory storage. Widening the gate to
bucket+endpoint lets a credential-less, instance-role deployment use real S3.

This preserves the "in-memory fallback must not masquerade as S3" guardrail: the
adapter only reports `kind: "s3-compatible"` when it actually constructs an S3
client (bucket+endpoint present); a genuinely incomplete config (missing endpoint
or bucket) still returns an honest `kind: "memory"` adapter. The credential
decision is isolated behind a small typed helper rather than inlined.

Behavior change to note: a deployment that sets `MINIO_BUCKET` + `MINIO_ENDPOINT`
but no credentials now gets a real S3 adapter (and will surface S3/credential
errors on first call) instead of silently degrading to in-memory storage.

## Verification

- TDD: added 4 failing tests first (`packages/adapters/src/adapters.test.ts`),
  confirmed RED for the expected reasons (`buildNodeS3ClientConfig` missing;
  `kind` was `memory` instead of `s3-compatible`), then implemented to GREEN.
  Tests cover: static-credentials config, credential-omitted (instance-role)
  config, region default, and adapter selection with no credentials.
- Updated the existing "incomplete env → memory" test to use a genuinely
  incomplete config (missing endpoint) to match the new selection contract.
- `pnpm --filter @knowledge/adapters test -- adapters` → 95 passed, 1 skipped.
- `pnpm --filter @knowledge/adapters test:coverage` → aggregate 93.33% stmts /
  91.51% branch / 96.4% funcs / 93.33% lines (all ≥ 90%).
- `pnpm --filter @knowledge/adapters typecheck` and repo-wide `pnpm typecheck`
  (18/18) pass.
- `pnpm test` (turbo, all packages) → all green.
- `biome check` clean on the changed source/test files.

## Risks / Follow-ups

- `pnpm lint` (repo-wide `biome check .`) is currently red on **pre-existing**
  formatting/lint debt in `apps/admin`, `apps/api`, and `packages/api` files that
  are unrelated to this change (introduced by earlier merges). Not fixed here to
  keep this PR's diff focused. Worth a separate cleanup pass.
- Terraform modules + deployment runbook are still TODO (`aws_terraform`).
- Multi-instance scale-out will still need a shared cache (ElastiCache); the Node
  cache adapter remains in-process. Tracked in `aws_terraform/README.md`.
- Full Aurora CA/SSL verification (`ssl: { ca }`) is still not configurable on the
  Postgres pool; instance-role work here does not address it.
