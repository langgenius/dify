# Durable query outcomes in Knowledge Space Overview

## Why

Overview inferred query outcomes from the best-effort `failed_queries` projection and, during
fallback, from EvidenceBundle presence. Capability v2 queries can persist an AnswerTrace without a
legacy permission snapshot, so failed-query capture may be skipped even though the trace is
durable. That caused empty or low-confidence retrievals to appear answered, while a missing bundle
could incorrectly classify a successful local answer as having no evidence.

## What changed

- Query completion now computes one normalized `answered`, `low-confidence`, or `no-evidence`
  outcome from the same finish reason, top score, and runtime threshold used by failed-query
  capture, then persists it in the terminal `query.generate` AnswerTrace metadata.
- Overview reads only the latest `query.generate` step using the existing `started_at, id` ordering
  contract, so ordinary retries use their terminal outcome without changing the trace schema.
- Legacy traces without `queryOutcome` remain compatible: explicit no-evidence finish reasons are
  recognized, and low confidence is reconstructed from the persisted retrieval-profile threshold
  and top score. A legacy FailedQuery remains an additional fallback when present.
- Stats build one query-fact relation and reuse it for all time windows instead of expanding
  repeated correlated failure lookups. PostgreSQL and TiDB migrations add a trace-oriented
  `failed_queries` index for the compatibility join.
- Overview continues to count only durable `query.requested` activity, so quality replays without
  a user query request do not inflate the dashboard.

## Verification

- Repository tests cover durable outcomes, legacy Capability low-confidence metadata, local
  evidence, explicit no-evidence finish reasons, and terminal `query.generate` selection in both
  supported SQL dialects.
- `pnpm --filter @knowledge/api test`
- `pnpm --filter @knowledge/database test`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/database typecheck`
- `pnpm db:migrations:check`
- `pnpm exec biome check ...`
- `git diff --check`
