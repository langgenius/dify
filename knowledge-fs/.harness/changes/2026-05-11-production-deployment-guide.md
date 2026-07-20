# Production Deployment Guide

## Summary

- Added `docs/production-deployment.md` for Phase 2 Sprint 9 production polish.
- Documented SaaS and Standalone deployment shapes while preserving the required Next.js Admin / Hono API separation.
- Linked the guide from the root README.

## Changes

- Added release gates for TypeScript, coverage, retrieval regression, Rust, WASM, Compose config, and diff hygiene.
- Documented runtime configuration for auth, object storage, database/cache, Unstructured, and Admin Console.
- Covered Cloudflare Pages + Workers deployment expectations for SaaS, including R2/KV/TiDB/Unstructured service provisioning and expected `wrangler` shape.
- Covered Docker Compose deployment for Standalone, including API/Admin service separation, MinIO bucket bootstrap, PostgreSQL migrations, and smoke checks.
- Added rollback and operational guardrails for bounded reads, cache keys, tenant safety, traces/logging, and retrieval regression gates.
- Recorded current deployment automation gaps so the guide does not imply unsupported runtime wiring already exists.

## Verification

- RED first:
  - `test -f docs/production-deployment.md` failed because the production deployment guide did not exist.
- Documentation verification:
  - `rg -n "Cloudflare Pages|Cloudflare Workers|wrangler|Standalone|Docker Compose|Hono API|Next.js Admin" docs/production-deployment.md README.md`
  - `pnpm lint`
  - `git diff --check`

## Commit Tracking

- This slice is review checkpoint `92f4e22` + implementation commit 8 after commit and push.
- The next 10-commit health review is not yet due.
