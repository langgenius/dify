# Knowledge Platform — Iteration Plan

> Source of truth: `rag-platform-redesign-technical-selection.md`
> Created: 2026-05-07
> Status: Historical roadmap; current execution index lives in `.harness/docs/consolidated-iteration-plan.md`

> Architecture decision override (2026-07-16): all project-owned compute is implemented in
> TypeScript under `packages/compute`. The Rust/WASM tasks preserved in the historical phase tables
> below describe the original roadmap and are no longer active architecture.

## Current Planning Index

The active, consolidated execution plan is now:

- `.harness/docs/consolidated-iteration-plan.md`

This file remains the long-form architecture roadmap and historical phase plan. New
implementation work should first check the consolidated plan, which merges the current
state of:

- core/local MVP closure;
- queryable ingestion;
- durable local runtime;
- code-review remediation;
- JuiceFS-inspired KnowledgeFS hardening;
- PageIndex-inspired document outlines and research tree search;
- native multimodal KnowledgeFS;
- Admin integration repair.

Do not delete the detailed historical sections below: they preserve the original
phase breakdown, task estimates, and completed-track context that later plans cite.

---

## Architecture Guardrails

This plan follows `rag-platform-redesign-technical-selection.md` as the only source of truth.

Hard boundaries:

- TypeScript owns orchestration, IO, HTTP APIs, MCP tools, streaming, database access, cache access, job coordination, provider adapters, and the Admin Console.
- Hono owns the Knowledge Gateway, OpenAPI, MCP, retrieval runtime, KnowledgeFS/SourceFS/EvidenceFS commands, jobs, providers, auth, policy, budget, audit, and streaming.
- Next.js owns the Admin Console and human-facing application shell. It may use thin BFF routes only for UI ergonomics; it must not own core knowledge, retrieval, ingestion, job, permission, or provider logic.
- TypeScript owns bounded pure compute modules: chunking, token counting, RRF fusion, evidence packing, and text diff.
- Compute modules must have no database, network, filesystem, cache, or streaming dependencies.
- Document parsing runs through self-hosted Unstructured API for complex documents and native TypeScript parsers for Markdown, HTML, and structured data.
- Embedding, reranking, and LLM generation are API-based through provider interfaces.
- The platform has two deployment targets: Cloudflare Workers for SaaS and Docker Node.js/Bun for Standalone.
- Storage/search defaults to database-as-search-engine: TiDB Cloud for SaaS and PostgreSQL + pgvector + FTS for Standalone, abstracted behind `DatabaseAdapter`.
- MCP and OpenAPI are first-class. A2A remains an isolated experimental adapter in Phase 5.
- Evaluation starts in Phase 1 and becomes CI-blocking in Phase 2.
- SourceFS, KnowledgeFS, EvidenceFS, ResourceMount, CommandRegistry, safe shell, and workspace snapshots are TypeScript platform features, not a separate filesystem service.
- Safe shell execution is an allowlisted command dispatcher over registered filesystem commands; it must never execute host shell commands.

Explicitly avoided in this plan:

- No Axum service.
- No sqlx service layer.
- No secondary language runtime or compute sidecar.
- No Tantivy search engine in the core architecture.
- No Python compiler/runtime as a platform dependency, except external services such as Unstructured or optional commercial/OCR/document AI APIs.
- No direct platform-specific APIs outside the platform adapter layer.

---

## Overview

This document breaks the Knowledge Platform redesign into 6 phases and 20 two-week sprints.

**Estimated duration**: 40 weeks with a team of 3-4 engineers.

**Architecture**: TypeScript-only Hono platform with bounded in-process compute, dual-deploy to Cloudflare Workers and Docker.

**Team composition assumption**:

| Role | Count | Primary Responsibility |
|---|---:|---|
| TypeScript Full-Stack Engineer | 2 | Gateway, Retrieval Runtime, KnowledgeFS, MCP/OpenAPI, generation, Admin Console |
| TypeScript Platform Engineer | 0.5 | Bounded chunker, tokenizer, fusion, packer, diff |
| Infra/DevOps | 0.5 | Cloudflare, Docker, TiDB/PostgreSQL, Unstructured, CI/CD |

---

## Dependency Map

```text
Phase 1: Foundation
  -> Phase 2: Production Retrieval
      -> Phase 3: Durable Ingestion
          -> Phase 4: Advanced Knowledge Compiler
              -> Phase 5: Agent-Native Research

Phase 6: Evaluation Platform starts as MVP in Phase 1,
         becomes CI regression in Phase 2,
         and expands into full quality governance after Phase 5.
```

---

## JuiceFS-Inspired KnowledgeFS Hardening Track

**Status**: Proposed as of 2026-05-27.

**Source design**: `.harness/docs/juicefs-inspired-knowledgefs-hardening.md`

**Detailed iteration plan**: `.harness/docs/juicefs-inspired-hardening-iteration-plan.md`

**Goal**: Absorb the production-grade control-plane lessons from JuiceFS without making
KnowledgeFS a POSIX/FUSE filesystem. This track strengthens KnowledgeFS around explicit
KnowledgeSpace manifests, immutable-content publication, staged commit recovery,
artifact segmentation, consistency classes, cache contracts, sessions, leases, fsck,
gc, status, stats, broader quota enforcement, and atomic projection publication.

**Architecture stance**:

- Keep KnowledgeFS virtual, API/MCP-first, and storage-agnostic.
- Do not make POSIX, FUSE, inode semantics, hard links, or byte-level random writes core requirements.
- Treat metadata as the operational control plane and object storage as the immutable data plane.
- Add operator repair and observability workflows before adding broad mutation or cleanup power.

### Proposed Hardening Milestones

| Milestone | Status | Scope | Outcome |
|---|---|---|---|
| JH-A | Proposed | Manifest, staged commit ledger, snapshot fingerprint, status foundation. | Every KnowledgeSpace becomes inspectable and staged writes become recoverable. |
| JH-B | Proposed | Immutable publication and artifact segmentation. | Large artifacts can be read and searched through bounded segment pages. |
| JH-C | Proposed | Sessions, leases, fsck diagnostics, and GC dry-run/mutation for staged objects. | Long-running work is visible and repair tools are safe by default. |
| JH-D | Proposed | Pipeline-wide quota, projection set fingerprints, atomic publication, rollback, and projection GC. | Retrieval reads coherent published projection sets and derived data remains bounded. |
| JH-E | Proposed | Admin/MCP operator surfaces and runbooks. | Humans and trusted agents can inspect, diagnose, and clean KnowledgeFS state safely. |

### Integration With Existing Tracks

This track should start after Durable Local Runtime and Queryable Ingestion remain
green, because it depends on reliable database/object-storage wiring and real uploaded
content becoming queryable evidence. It can run in parallel with Admin Integration
Repair if the first slices stay backend-only.

The first implementation slice should be `JH.1.1` through `JH.1.4` from the detailed
plan: KnowledgeSpace manifest model, repository, database schema, and bootstrap path.
That gives later artifact, session, fsck, and quota work a stable control-plane anchor.

---

## Core Closure Track: Local Usable MVP

**Status**: Completed as of 2026-05-21.

**Goal**: Stop broad feature expansion temporarily and make the current system usable as a local end-to-end product loop: start middleware, start API/Admin from source, create/select a KnowledgeSpace, upload a document, see real ingestion state, inspect parse artifacts, and run a basic query path from the Admin Console.

**Why this track exists**:

- The backend contracts and many platform modules exist, but the Admin Console still mixes static demo panels with a few real forms.
- Local users need a clear, working path through the product before more advanced retrieval, compiler, or agent features are added.
- Core closure work must preserve the established architecture boundaries: Hono owns business behavior, Next.js owns the UI shell and thin BFF, and browser network paths must go through the Admin BFF allowlist.

### Core Closure Iterations

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| CC.1 | Done 2026-05-21 | Real Admin workspace bootstrap and selection | Admin page/BFF tests prove the UI renders real workspace ids when API data exists and falls back safely to local `workspace` bootstrap when empty. | Upload, golden question, and bad-case forms target a real space id when available; local fallback still creates `workspace` through BFF. |
| CC.2 | Done 2026-05-21 | Upload result UI | Tests prove upload success/failure responses are surfaced instead of browser raw JSON/error pages. | Uploading a Markdown/HTML file updates the page with document id, parser status, size, hash, and next status/artifact links. |
| CC.3 | Done 2026-05-21 | Document status and parse artifact view | Tests prove Admin reads `GET document` and `GET parse artifact` through BFF. | A user can click from upload result to see persisted `DocumentAsset` and parse elements for version 1. |
| CC.4 | Done 2026-05-21 | Replace static health/readiness panels with live API data | Tests prove health and parser/document summary panels are loaded from bounded API calls or clearly marked unavailable. | Top health cards and publish readiness represent real API state for the selected workspace/document. |
| CC.5 | Done 2026-05-21 | Real query form path | Tests prove `Run query` submits through BFF/API and displays streamed or bounded answer output. | User can run a query against the selected workspace and see answer text, citations, and trace id or a clear failure state. |
| CC.6 | Done 2026-05-21 | Hide or mark non-functional demo panels | Snapshot/HTML tests prove remaining static panels are labelled as preview/coming soon or removed from primary workflow. | The first viewport presents working actions; demo diagnostics are marked as preview data. |
| CC.7 | Done 2026-05-21 | Local happy-path smoke script | Script test proves local commands and endpoints are documented and wired. | One documented sequence validates middleware config, API health, Admin build, workspace bootstrap, upload, and artifact read without manual DB edits. |

### Core Closure Verification

Each core closure iteration must run the relevant targeted tests plus:

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `git diff --check`

Docker-dependent checks should run when the local daemon is available; otherwise record the environment limitation in `.harness/changes`.

---

## Admin Integration Repair Track

**Status**: Active as of 2026-05-22.

**Goal**: Keep the visible Admin Console controls aligned with real API/BFF contracts so users do not hit browser-side 404s, invalid default form submissions, or preview actions that look more complete than they are.

### Admin Integration Repair Iterations

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| AIR.1 | Done 2026-05-22 | Repair upload/readiness/citation live paths | Admin page and BFF tests prove upload no longer sends an invalid default `sourceId`, parser checking uses the BFF health path, query citation links target trace reads, and graph/KnowledgeFS BFF methods match the API. | Admin markdown upload works through the redirect handler, BFF workspace bootstrap, Hono upload, and parse artifact read in one focused integration test. |
| AIR.2 | Done 2026-05-26 | Repair local API base and Compose upstream wiring | Tests prove source local defaults avoid the common workerd `8787` port, Admin server-side calls prefer `KNOWLEDGE_API_BASE_URL`, public display still uses `NEXT_PUBLIC_API_BASE_URL`, and Compose Admin calls the API service over `http://api:8787`. | Local API/Admin health and upload work through `8788`, Admin BFF health returns KnowledgeFS component health, and upload redirects with `uploadStatus=success`. |
| AIR.3 | Planned | Audit remaining preview panels for false affordances | Page tests prove preview-only sections cannot submit broken form bodies to JSON-only API routes, or route through dedicated handlers when they become live. | Golden question, annotation, evaluation, Retrieval Studio, and diagnostics panels are either live with integration tests or visually/non-interactively marked as preview. |

### Admin Integration Repair Verification

Each repair iteration must run targeted Admin/API integration tests plus:

- `pnpm --filter @knowledge/admin test`
- `pnpm --filter @knowledge/api test -- src/admin-bff-integration.test.ts`
- `pnpm --filter @knowledge/admin typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `git diff --check`

---

## Queryable Ingestion Track: Uploaded Content Becomes Evidence

**Status**: Active as of 2026-05-21.

**Goal**: Close the product loop behind the Admin Console: a locally uploaded document must become queryable evidence without manual database edits, fake preview data, or hidden setup.

**Why this track exists**:

- Core Closure made the Admin Console usable and honest, but a successful upload still needs to prove that parsed content flows into nodes, retrieval, and query answers by default.
- The architecture already separates parser, compute, node repositories, retrieval, and generation. This track wires those boundaries into a minimal local loop while preserving those ownership lines.
- Each slice must stay bounded: no unbounded reads, no N+1 database paths, no in-memory production assumptions without explicit fallback labeling.

### Queryable Ingestion Iterations

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| QI.1 | Done 2026-05-21 | Synchronous upload node generation | Gateway upload tests prove that when a compute runtime is injected, the parsed artifact is passed through the incremental reindexer and creates KnowledgeNodes. | Upload still returns parsed `DocumentAsset`; no-compute fallback preserves artifact-only behavior; compute path records bounded `ingestion.nodes_reindex` trace span. |
| QI.2 | Done 2026-05-21 | Default local compute runtime wiring | API runtime tests prove Node local app can load the WASM compute runtime or fail with a clear readiness state. | `apps/api` provides compute without hand-written test injection when the WASM package is present, and falls back cleanly when it is absent or disabled. |
| QI.3 | Done 2026-05-21 | Local query generator over generated nodes | Query tests prove `/queries` can answer from stored nodes with citations when no external LLM provider is configured. | Local queries return evidence-backed SSE text and node citations instead of 503 when no external generator is configured. |
| QI.4 | Done 2026-05-21 | Extend local happy-path smoke to query evidence | Script tests prove the smoke checks upload, artifact read, node-backed query, citations, and trace id under bounded response limits. | `pnpm local:happy-path` validates the full local core loop through query evidence. |
| QI.5 | Done 2026-05-21 | Exercise Admin BFF upload in local smoke | Script tests prove the live smoke checks Admin BFF health and uploads through the `/api/bff/knowledge-spaces/{id}/documents` proxy path. | Local smoke catches Admin BFF upload proxy regressions before users hit browser-side 404s. |

### Queryable Ingestion Verification

Each queryable ingestion iteration must run the relevant targeted tests plus:

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `git diff --check`

Run `cargo test --workspace`, `pnpm wasm:build`, and Compose config checks whenever the slice touches compute/runtime/infra paths.

---

## Durable Local Runtime Track: Source-Run Persistence

**Status**: Active as of 2026-05-21.

**Goal**: Make the source-run local stack durable by wiring middleware services into the Node runtime while preserving bounded in-memory fallbacks for tests and no-config development.

**Why this track exists**:

- The Admin/API local loop can now upload, parse, chunk, and query evidence, but the source-run API still defaults to in-memory repositories unless callers inject database-backed implementations.
- Local middleware already provides PostgreSQL and MinIO, so the next product-quality step is making `DATABASE_URL` opt into real parameterized SQL execution and then using that execution boundary for core repositories.
- The work must preserve strict bounds: no unbounded reads, no N+1 repository wiring, and no production path that silently masquerades as durable storage when it is actually in memory.

### Durable Local Runtime Iterations

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| DLR.1 | Done 2026-05-21 | PostgreSQL executor for Node adapter | Adapter tests prove `DATABASE_URL` wires a pool-backed executor, parameter arrays are preserved, health uses a bounded probe, and close drains the pool. | Node `DatabaseAdapter.execute()` can run parameterized SQL through PostgreSQL when configured; no-config behavior remains schema-only. |
| DLR.2 | Done 2026-05-21 | Database-backed gateway repository bundle | API app/runtime tests prove complete DB config switches KnowledgeSpace, DocumentAsset, ParseArtifact, KnowledgeNode, and IndexProjection repositories to database-backed implementations together. | Source-run API persists upload/query state in PostgreSQL when `DATABASE_URL` is set; missing DB config keeps bounded memory fallback. |
| DLR.3 | Done 2026-05-21 | Local migration bootstrap command | Script tests prove migrations can be applied once through the configured executor before source-run API startup. | A documented local command applies checked-in SQL migrations to PostgreSQL without manual DB edits. |
| DLR.4 | Done 2026-05-21 | Source API `.env` loading | API app script tests prove `pnpm dev:api` loads root `.env` before starting the source server. | Source-run API sees the same `DATABASE_URL`, MinIO, and auth env used by migration and docs. |
| DLR.5 | Done 2026-05-21 | Optional migration step in local smoke | Smoke script tests prove a single opt-in env flag runs checked-in migrations before API health/upload/query checks. | `LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path` validates the durable source-run setup without manual SQL. |
| DLR.6 | Done 2026-05-21 | API-only local smoke command | Smoke script tests prove an explicit command skips Admin build/BFF while preserving bounded API upload, artifact, and query evidence checks. | `pnpm local:happy-path:api` validates the API source process when the Admin dev server is intentionally not running. |
| DLR.7 | Done 2026-05-21 | Durable local smoke command | Smoke script tests prove an explicit command requires `DATABASE_URL`, MinIO env, and healthy database/object storage before validating the full local loop. | `pnpm local:happy-path:durable` fails fast when the source-run stack is not using durable local middleware. |
| DLR.8 | Superseded 2026-07-16 | API TypeScript compute packaging | Dockerfile tests prove the production API image bundles the TypeScript compute workspace with no generated runtime artifact. | Containerized API ingestion has the same built-in compute implementation as source-run Node. |
| DLR.9 | Superseded 2026-07-16 | Generated compute artifact smoke | The dedicated generated-artifact import smoke was removed with the external compute artifact. | TypeScript compute behavior is covered by package tests and the isolated bundle health probe. |
| DLR.10 | Updated 2026-07-16 | Isolated API bundle smoke | Workflow and script tests prove CI starts the built API image under `NODE_ENV=test`, checks `/health`, and requires `components.compute === true`. | `pnpm docker:api:bundle-smoke` catches bundle/startup failures but is explicitly not a production fail-closed or durable-dependency gate. |
| DLR.11 | Done 2026-05-21 | App Compose profile contract guardrail | Script tests prove the full app profile keeps API image build wiring, middleware readiness dependencies, service-local API middleware URLs, and Admin source-run BFF base URL. | `pnpm compose:apps:test` runs in `pnpm check` and CI before Compose config rendering. |
| DLR.12 | Done 2026-05-21 | Admin production Docker image | Dockerfile and Compose tests prove the Admin app profile runs a Next.js standalone production image instead of a bind-mounted dev server. | `pnpm docker:admin:build` is available, CI builds the Admin image, and full app Compose uses `knowledge-fs-admin:local`. |
| DLR.13 | Done 2026-05-21 | Admin image HTTP homepage smoke | Workflow and script tests prove CI starts the production Admin image and checks the standalone homepage. | `pnpm docker:admin:http-smoke` catches Next standalone startup and route-render failures after the image builds. |
| DLR.14 | Updated 2026-07-16 | Docker build context hygiene | Script tests prove nested TypeScript build artifacts and dependency directories are excluded from Docker build contexts. | `.dockerignore` excludes nested `.next`, `.turbo`, `coverage`, `dist`, and `node_modules` directories without hiding source workspaces. |
| DLR.15 | Updated 2026-07-16 | One-command app image smoke | Script tests prove the root package exposes a single ordered command for building both images and running the correctly scoped checks. | `pnpm docker:apps:smoke` builds both app images, runs the isolated API bundle check, and runs the Admin HTTP homepage smoke; deployed/Compose flows remain the production API gate. |

### Durable Local Runtime Verification

Each durable runtime iteration must run the relevant targeted tests plus:

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `git diff --check`

Run `pnpm compose:middleware:config` when middleware env or Compose docs change.

---

## Code Health Track: API God File Decomposition

**Status**: Active as of 2026-05-21.

**Goal**: Continue resolving `docs/code-review-issues.md` H1 by shrinking `packages/api/src/index.ts` into bounded domain modules with code-health guardrails that prevent responsibilities from drifting back into the gateway composition file.

### God File Decomposition Iterations

| # | Status | Task | TDD Focus | Done Criteria |
|---|---|---|---|---|
| GF.1 | Done 2026-05-21 | Extract Research Task HTTP handlers | Code-health test proves research task route registration cannot live in `packages/api/src/index.ts`. | `registerResearchTaskHandlers` owns plan/create/get/partials/events/cancel routes; gateway composition only wires dependencies. |
| GF.2 | Done 2026-05-21 | Extract document write and bulk ingestion handlers | Code-health test proves upload/bulk upload/bulk delete/bulk reindex route registration cannot live in `packages/api/src/index.ts`. | Document write handlers own upload, sync ingestion fallback, job dispatch, bulk operation lifecycle, and bounded cleanup behavior. |
| GF.3 | Done 2026-05-21 | Split gateway tests by domain | Code-health test proves the gateway integration test file cannot keep growing as a cross-domain god test. | `gateway-document-write.test.ts` owns synchronous document upload and durable upload job scenarios; gateway coverage is preserved while the cross-domain file is smaller. |
| GF.4 | Done 2026-05-21 | Continue document bulk gateway test split | Code-health test proves bulk upload/delete/reindex scenarios move out of the cross-domain gateway test file. | Bulk document operation tests live in `gateway-document-write.test.ts` with bounded cleanup, tenant, quota, and job-progress assertions preserved. |
| GF.5 | Done 2026-05-21 | Extract document compilation gateway route tests | Code-health test proves document compilation job status/cancel routes are no longer embedded in the cross-domain gateway test file. | Document compilation route and job status/cancel tests live in `gateway-document-compilation.test.ts` while preserving tenant/scope assertions. |
| GF.6 | Planned | Extract document compilation worker tests | Code-health test proves durable document compilation worker parse/reindex/publication scenarios are no longer embedded in the cross-domain gateway test file. | Worker integration tests live in the focused document compilation test file with evaluation-gate and failure-path assertions preserved. |

### Code Health Verification

Each decomposition iteration must run the relevant targeted tests plus:

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `git diff --check`

---

## Phase 1: Foundation

**Duration**: 8 weeks (Sprint 1-4)

**Goal**: Build the minimum end-to-end loop: upload document, parse, chunk, index, retrieve, cite, and browse via KnowledgeFS.

### Sprint 1: Project Skeleton + Data Model (Week 1-2)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 1.1.1 | Initialize TypeScript monorepo | 4h | TS | pnpm, Turborepo, Hono, Vitest, Biome | — | `pnpm build` passes; packages include `@knowledge/api`, `@knowledge/core`, `@knowledge/adapters` |
| 1.1.2 | Define Hono/Next.js package boundary | 4h | TS | pnpm workspaces, OpenAPI client layout | 1.1.1 | `apps/api` owns Hono platform APIs; `apps/admin` owns Next.js UI; shared clients/types live in packages |
| 1.1.3 | Initialize Rust WASM workspace | 4h | Rust WASM | Rust, wasm-pack, wasm-bindgen, serde | — | `wasm-pack build` passes for placeholder modules |
| 1.1.4 | Define `PlatformAdapter` interface | 8h | TS | TypeScript, Zod | 1.1.1 | Adapter contracts for DB, object storage, cache, job queue, durable state, providers |
| 1.1.5 | Add Cloudflare and Docker adapter skeletons | 8h | TS | Workers bindings, Node adapters | 1.1.4 | App code can receive either adapter without conditional imports |
| 1.1.6 | Set up CI/CD | 6h | DevOps | GitHub Actions, wrangler, Docker | 1.1.1, 1.1.3 | PR runs lint, typecheck, tests, wasm build; main can deploy/build |
| 1.1.7 | Design core schema: `KnowledgeSpace`, `Source`, `DocumentAsset` | 8h | TS | Drizzle ORM, PostgreSQL/TiDB migrations | 1.1.4 | Migrations compile for PostgreSQL and TiDB dialect targets |
| 1.1.8 | Design artifact schema: `ParseArtifact`, `KnowledgeNode`, `IndexProjection` | 10h | TS | Drizzle, Zod | 1.1.7 | Versioning fields from technical selection are represented |
| 1.1.9 | Design evidence schema: `KnowledgePath`, `EvidenceBundle`, `AnswerTrace` | 8h | TS | Drizzle, Zod | 1.1.7 | Evidence, trace, and virtual path entities exist |
| 1.1.10 | Implement object storage adapter | 6h | TS | `@aws-sdk/client-s3`, R2, MinIO/local | 1.1.4 | Read/write/delete tests pass against local S3-compatible backend |
| 1.1.11 | Local development environment | 6h | DevOps | Docker Compose, wrangler dev | 1.1.7 | PostgreSQL + pgvector, MinIO, Unstructured, and app start locally |

**Sprint 1 Total**: ~72h

### Sprint 2: Gateway + Basic Ingestion (Week 3-4)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 1.2.1 | Implement Hono Gateway skeleton | 6h | TS | Hono, Zod | 1.1.1, 1.1.2 | Workers and Node modes expose `/health` |
| 1.2.2 | Implement OpenAPI generation | 6h | TS | `@hono/zod-openapi` | 1.2.1 | OpenAPI 3.1 spec generated from route schemas |
| 1.2.3 | Implement KnowledgeSpace CRUD | 8h | TS | Hono, Drizzle | 1.2.2, 1.1.7 | CRUD endpoints work with auth subject attached by middleware |
| 1.2.4 | Implement document upload API | 8h | TS | Hono multipart, S3 adapter, Drizzle | 1.2.3, 1.1.10 | Upload creates immutable `DocumentAsset` and object pointer |
| 1.2.5 | Implement Unstructured parser client | 8h | TS | fetch, Zod | 1.1.8 | PDF/DOCX/PPTX request returns validated `ParseArtifact` JSON |
| 1.2.6 | Implement native Markdown/HTML parsers | 8h | TS | markdown parser, htmlparser2 | 1.1.8 | Markdown/HTML parse in-process in Workers and Node |
| 1.2.7 | Implement synchronous MVP ingestion | 8h | TS | Hono, Drizzle, parser adapters | 1.2.4, 1.2.5, 1.2.6 | Upload -> parse -> store artifact -> update status |
| 1.2.8 | Implement auth middleware | 8h | TS | Hono middleware, jose | 1.2.1 | Subject identity is derived server-side; unauthenticated requests return 401 |
| 1.2.9 | Add basic OpenTelemetry trace hooks | 6h | TS | OpenTelemetry, Workers Trace/Node SDK | 1.2.1 | HTTP requests and ingestion steps emit trace ids |

**Sprint 2 Total**: ~66h

### Sprint 3: Chunking + Indexing + Basic Retrieval (Week 5-6)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 1.3.1 | Implement WASM chunker | 16h | Rust WASM | wasm-bindgen, serde, unicode-segmentation | 1.1.3, 1.2.5 | `chunk(parse_artifact_json, config)` returns section-aware `KnowledgeNode` list |
| 1.3.2 | Implement WASM tokenizer | 8h | Rust WASM | tiktoken-rs or custom BPE | 1.1.3 | `count_tokens` works in Workers and Node |
| 1.3.3 | Wire WASM modules into TypeScript runtime | 8h | TS + WASM | WASM loader, Vitest | 1.3.1, 1.3.2 | Same TS call path works in both deployment modes |
| 1.3.4 | Persist KnowledgeNodes | 8h | TS | Drizzle ORM | 1.1.8, 1.3.3 | Batch insert includes source location, permission scope, artifact hash |
| 1.3.5 | Implement embedding provider interface | 10h | TS | fetch, Zod | 1.1.4 | OpenAI/Voyage/Cohere-style provider contract returns dense embeddings |
| 1.3.6 | Build dense vector projection | 10h | TS | Drizzle, pgvector/TiDB vector SQL | 1.3.4, 1.3.5 | Embeddings stored with model version and projection id |
| 1.3.7 | Build FTS projection | 8h | TS | PostgreSQL tsvector/TiDB FULLTEXT | 1.3.4 | Text searchable by database-native FTS |
| 1.3.8 | Implement basic hybrid retrieval | 12h | TS + WASM | Drizzle, WASM RRF placeholder | 1.3.6, 1.3.7 | Vector + FTS queries run in parallel and return fused top-K |
| 1.3.9 | Implement citation source location response | 6h | TS | Drizzle, Zod | 1.3.8 | Each result contains document id, version, page/section/offset/hash |

**Sprint 3 Total**: ~86h

### Sprint 4: KnowledgeFS Skeleton + Evaluation MVP + E2E (Week 7-8)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 1.4.1 | Implement KnowledgeFS resource model | 10h | TS | Drizzle, Zod | 1.1.9 | Virtual path records support physical views |
| 1.4.2 | Define SourceFS/EvidenceFS path namespaces | 8h | TS | Zod, Drizzle | 1.4.1 | `/sources`, `/knowledge`, `/evidence`, and `/workspaces` namespaces are specified |
| 1.4.3 | Implement `ResourceMount` model | 10h | TS | Drizzle, Zod | 1.4.1 | Mounts include path, resource type, mode, capabilities, freshness, cache, permission scope |
| 1.4.4 | Implement `ls` and `tree` endpoints | 10h | TS | Hono, Drizzle | 1.4.1, 1.4.2 | Paginated directory listing works across KnowledgeFS namespaces |
| 1.4.5 | Implement `cat` and `stat` endpoints | 8h | TS | Hono, Drizzle, S3 adapter | 1.4.4 | Node/page/artifact metadata can be fetched |
| 1.4.6 | Implement MCP server skeleton | 10h | TS | `@modelcontextprotocol/sdk` | 1.4.4, 1.4.5 | Exposes `knowledge.fs.ls`, `knowledge.fs.cat`, `knowledge.search` |
| 1.4.7 | Implement golden question CRUD | 8h | TS | Hono, Drizzle | 1.3.8 | Golden questions and expected evidence ids are stored |
| 1.4.8 | Implement retrieval evaluation MVP | 8h | TS | Vitest, evaluation runner | 1.4.7 | Computes recall@K, citation hit rate, no-answer rate |
| 1.4.9 | Implement cache adapter | 8h | TS | KV, Redis, in-memory LRU | 1.1.4 | Version-aware cache namespace works in both modes |
| 1.4.10 | End-to-end integration test | 12h | All | Vitest, wrangler dev, Docker Compose | Phase 1 tasks | Upload PDF -> parse -> chunk -> index -> retrieve -> cite |
| 1.4.11 | Build Standalone Docker image | 6h | DevOps | Dockerfile, Docker Compose | 1.4.10 | One-command local deployment works |

**Sprint 4 Total**: ~98h

### Phase 1 Milestone

```text
TypeScript monorepo and Hono Gateway
Hono/Next.js boundary with generated/shared API clients
Rust WASM pure compute workspace
Platform adapter layer for Cloudflare and Docker
Core schema for assets, artifacts, nodes, projections, evidence, traces
Unstructured parser client and native Markdown/HTML parsers
WASM chunker and tokenizer
Embedding provider interface
Database-native dense vector + FTS projections
Basic hybrid retrieval with citations
KnowledgeFS skeleton
SourceFS/EvidenceFS namespaces
ResourceMount model
MCP skeleton
Evaluation MVP
Version-aware cache adapter
Workers and Docker E2E validation
```

---

## Phase 2: Production Retrieval

**Duration**: 10 weeks (Sprint 5-9)

**Goal**: Move retrieval from MVP to production quality: hybrid recall, reranking, permission filtering, EvidenceBundle, generation, KnowledgeFS tools, caching, rate limiting, degradation, and CI regression.

### Sprint 5: Hybrid Retrieval + Reranking (Week 9-10)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 2.5.1 | Tune CJK/English FTS | 10h | TS + DevOps | pg_jieba/pg_bigm, TiDB parser config | 1.3.7 | Mixed Chinese/English queries pass golden recall checks |
| 2.5.2 | Implement WASM RRF fusion | 8h | Rust WASM | wasm-bindgen, serde | 1.1.3 | `rrf_fuse(ranked_lists, weights, k)` works in both modes |
| 2.5.3 | Add retrieval planner and mode router | 12h | TS | Query features, rules, cache | 1.3.8 | `fast`, `deep`, `research`, and `auto` route decisions are traced |
| 2.5.4 | Optimize hybrid recall | 14h | TS + WASM | Drizzle, DatabaseAdapter, WASM RRF | 2.5.1, 2.5.2 | Vector + FTS + metadata filters return fused candidates with latency metrics |
| 2.5.5 | Implement reranker provider interface | 8h | TS | fetch, Zod | 1.1.4 | Cohere/Voyage-style rerank contract is provider-agnostic |
| 2.5.6 | Integrate reranking into retrieval runtime | 8h | TS | Provider adapter, tracing | 2.5.4, 2.5.5 | Recall 50-200 -> rerank -> top evidence candidates |
| 2.5.7 | Implement query normalization cache | 6h | TS | KV/Redis/LRU adapter | 2.5.3 | Cache key includes query normalization and strategy version |
| 2.5.8 | Compare dense-only vs FTS-only vs hybrid | 6h | TS | Evaluation runner | 2.5.6, 1.4.6 | Evaluation report identifies recall/citation impact |

**Sprint 5 Total**: ~72h

### Sprint 6: Evidence Bundle + Permission + Trace (Week 11-12)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 2.6.1 | Implement EvidenceBundle contract | 10h | TS | Zod, TypeScript | 2.5.6 | EvidenceBundle includes scores, citations, conflicts, freshness, missing evidence |
| 2.6.2 | Implement EvidenceBundle assembly | 12h | TS + WASM | Drizzle, WASM packer placeholder | 2.6.1 | Reranked candidates become structured evidence |
| 2.6.3 | Implement answerability states | 8h | TS | Rule-based score and evidence checks | 2.6.2 | Returns answerable, partial, not enough evidence, conflict, permission-limited states |
| 2.6.4 | Implement permission filtering | 16h | TS | Hono middleware, Drizzle WHERE clauses, ACL snapshots | 1.2.8, 2.5.4 | Retrieval filters unauthorized nodes before evidence packing and generation |
| 2.6.5 | Implement metadata filters | 10h | TS | Drizzle SQL builder | 2.5.4 | Request filters support document types, sources, dates, entities, tags, languages, freshness, node types |
| 2.6.6 | Implement EvidenceBundle cache | 8h | TS | CacheAdapter | 2.6.2 | Cache key includes query, permission snapshot, strategy, and index projection |
| 2.6.7 | Implement AnswerTrace recording | 12h | TS | Drizzle, OpenTelemetry | 2.6.2 | Trace records normalize -> route -> recall -> filter -> rerank -> evidence |
| 2.6.8 | Implement trace API | 6h | TS | Hono, Drizzle | 2.6.7 | `GET /queries/{trace_id}` returns trace JSON |

**Sprint 6 Total**: ~82h

### Sprint 7: Generation Layer + Streaming (Week 13-14)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 2.7.1 | Implement LLM provider interface | 10h | TS | fetch, SSE parsing, Zod | 1.1.4 | Claude/OpenAI-style streaming and non-streaming providers work behind one interface |
| 2.7.2 | Implement LLM routing | 6h | TS | Config, retrieval mode | 2.7.1, 2.5.3 | Fast/deep/research select model policies |
| 2.7.3 | Implement WASM evidence packer | 12h | Rust WASM | serde, tokenizer binding | 1.3.2, 2.6.2 | `pack_evidence(evidence_items, token_budget, model)` returns packed context |
| 2.7.4 | Wire context window packing | 8h | TS + WASM | LLM registry, packer | 2.7.3 | Budget split for system/evidence/output is enforced |
| 2.7.5 | Implement evidence-driven prompt templates | 8h | TS | Template registry | 2.7.4 | Templates are versioned and strategy-specific |
| 2.7.6 | Implement SSE streaming generation | 10h | TS | Hono streaming/SSE | 2.7.5 | Query endpoint can stream answer chunks |
| 2.7.7 | Implement generation cost tracking | 8h | TS | Provider price registry | 2.7.6 | Response includes retrieval/generation cost breakdown |
| 2.7.8 | Implement citation normalization | 10h | TS | Parser/rules | 2.7.6 | Orphan citations removed; cited ids map to evidence items |
| 2.7.9 | Implement generation cache and skip path | 8h | TS | CacheAdapter | 2.7.7 | Same evidence/template/model can cache; budget/model failure returns EvidenceBundle |

**Sprint 7 Total**: ~80h

### Sprint 8: KnowledgeFS Complete + Rate Limiting + Degradation (Week 15-16)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 2.8.1 | Implement KnowledgeFS `grep` | 12h | TS | Hono, DatabaseAdapter FTS, scope limits | 1.4.4, 2.5.1 | Exact search is permission-aware, scoped, paginated, and timeout-limited |
| 2.8.2 | Implement KnowledgeFS `find` | 8h | TS | Hono, Drizzle | 1.4.4 | Metadata search supports type, owner, source, time, permission, language, freshness |
| 2.8.3 | Implement WASM text diff | 8h | Rust WASM | similar crate, serde | 1.1.3 | `diff_text(old, new)` returns line/word-level diff JSON |
| 2.8.4 | Implement KnowledgeFS `diff` and `open_node` | 10h | TS + WASM | Hono, Drizzle, diff module | 1.4.5, 2.8.3 | Version diff and citation-ready node fetch work |
| 2.8.5 | Implement CommandRegistry | 12h | TS | Zod, Hono, policy hooks | 1.4.3, 2.8.1, 2.8.2, 2.8.4 | Commands have schemas, handlers, overrides, permission checks, cost estimators, trace hooks |
| 2.8.6 | Implement SourceFS mount inspection tools | 10h | TS | ResourceMount, CommandRegistry | 1.4.3, 2.8.5 | `source.ls`, `source.cat`, and `source.grep` work for upload/object-storage mounts |
| 2.8.7 | Implement safe shell planner/executor | 12h | TS | Command parser, CommandRegistry | 2.8.5 | Allowlisted `ls/cat/grep/find/stat/diff/head/tail/wc/jq` pipelines run without host shell execution |
| 2.8.8 | Complete MCP KnowledgeFS tools | 12h | TS | `@modelcontextprotocol/sdk` | 2.8.1, 2.8.2, 2.8.4, 2.8.5 | Exposes ls, tree, cat, grep, find, stat, diff, open_node |
| 2.8.9 | Implement MCP retrieval and shell tools | 10h | TS | MCP SDK, retrieval runtime | 2.6.2, 2.7.6, 2.8.7 | Exposes `knowledge.search`, `knowledge.fetch_evidence`, `knowledge.shell.plan`, `knowledge.shell.execute` |
| 2.8.10 | Implement rate limiting | 10h | TS | Hono middleware, KV/Redis/in-memory counters | 1.2.8 | Per-tenant, per-agent, per-tool limits return 429 with structured metadata |
| 2.8.11 | Implement degradation flags | 10h | TS | Provider health, fallback policies | 2.7.1, 2.5.5 | Embedding/rerank/LLM failures degrade to configured fallback paths |
| 2.8.12 | Implement component health endpoint | 6h | TS | Hono, adapter health checks | 2.8.11 | `/health` reports DB, object store, cache, parser, embedding, reranker, LLM |

**Sprint 8 Total**: ~118h

### Sprint 9: Human UX + CI Regression + Production Polish (Week 17-18)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 2.9.1 | Initialize Next.js Admin Console | 8h | Full-Stack | TypeScript, Next.js, React | 1.1.2 | Console runs in dev and can be bundled for Standalone |
| 2.9.2 | Generate and wire Hono API client | 8h | Full-Stack | OpenAPI client, SSE client | 1.2.2, 2.9.1 | Admin Console calls Hono APIs through generated/shared clients |
| 2.9.3 | Define UI BFF constraints | 4h | Full-Stack | Next.js routes/server actions | 2.9.1 | Any Next.js BFF route is thin, UI-only, and delegates core behavior to Hono |
| 2.9.4 | Build upload UI and health report | 16h | Full-Stack | Next.js, React, API client | 2.9.2, 1.2.4 | Shows parse status, node count, quality risks, publish readiness |
| 2.9.5 | Build retrieval UI | 16h | Full-Stack | Next.js, React, SSE client | 2.9.2, 2.7.6 | Streaming answer, inline citations, confidence, freshness |
| 2.9.6 | Build retrieval trace viewer | 12h | Full-Stack | Next.js, React | 2.9.2, 2.6.8 | Shows route, recall candidates, filters, rerank, evidence |
| 2.9.7 | Implement CI regression evaluation | 12h | TS + DevOps | Vitest, GitHub Actions | 1.4.8, 2.5.8 | PR fails on severe recall or citation regression |
| 2.9.8 | Add embedding/rerank/path cache polish | 10h | TS | CacheAdapter | 2.5.5, 2.8.5 | Caches include model/permission/index versions |
| 2.9.9 | Implement session context basics | 10h | TS | Drizzle, CacheAdapter | 2.6.7 | Session TTL, previous queries, active docs/entities, permission invalidation |
| 2.9.10 | Production deployment guide | 6h | DevOps | Markdown, Docker Compose, wrangler | Phase 2 tasks | SaaS and Standalone deployment docs cover separate Next.js UI and Hono API deployment |

**Sprint 9 Total**: ~102h

### Phase 2 Milestone

```text
Production hybrid retrieval
API-based reranking
Permission-filtered EvidenceBundle
Answerability states
Evidence-driven generation with streaming
Citation normalization
Full KnowledgeFS command set
CommandRegistry-backed SourceFS/KnowledgeFS/EvidenceFS commands
Safe shell planning and execution
Full MCP retrieval and filesystem tools
Rate limiting and degradation paths
Health endpoint
Admin upload/query/trace UI
Next.js Admin Console consuming Hono OpenAPI/SSE clients
CI regression evaluation
Session context basics
Production deployment docs
```

---

## Phase 3: Durable Ingestion

**Duration**: 6 weeks (Sprint 10-12)

**Goal**: Upgrade synchronous ingestion into a durable, versioned, rollbackable, observable pipeline.

### Sprint 10: Job Runtime + Versioned Ingestion (Week 19-20)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 3.10.1 | Define `JobQueue` adapter contract | 8h | TS | TypeScript, Zod | 1.1.4 | Contract covers enqueue, lease, heartbeat, retry, cancel, status |
| 3.10.2 | Implement Cloudflare job adapter | 12h | TS | Cloudflare Queues, Durable Objects | 3.10.1 | Queues deliver work; Durable Objects track per-job state |
| 3.10.3 | Implement Standalone job adapter | 12h | TS | pg-boss | 3.10.1 | PostgreSQL-backed jobs support retry, timeout, cancellation |
| 3.10.4 | Implement DocumentCompilationJob state machine | 12h | TS | JobQueue, Drizzle | 3.10.2, 3.10.3 | queued -> parsed -> nodes_generated -> projection_built -> smoke_eval_passed -> published |
| 3.10.5 | Migrate ingestion to durable jobs | 12h | TS | Hono, JobQueue, parser providers | 3.10.4, 1.2.7 | Upload creates job and returns status endpoint |
| 3.10.6 | Implement job status/cancel APIs | 8h | TS | Hono, Drizzle | 3.10.4 | `GET /jobs/{id}` and `DELETE /jobs/{id}` work |
| 3.10.7 | Implement IndexProjection versioning | 12h | TS | Drizzle, DatabaseAdapter | 1.1.8 | New projection builds without overwriting active projection |

**Sprint 10 Total**: ~76h

### Sprint 11: Blue-Green Publishing + Parser Router (Week 21-22)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 3.11.1 | Implement blue-green index publication | 12h | TS | Drizzle, DatabaseAdapter | 3.10.7 | Candidate projection can evaluate, publish, and rollback |
| 3.11.2 | Implement embedding model registry | 8h | TS | Drizzle, Zod | 3.10.7 | Stores model id, version, dimension, metric, tokenizer, max tokens |
| 3.11.3 | Implement embedding model upgrade flow | 14h | TS | JobQueue, evaluation runner | 3.11.1, 3.11.2 | Re-embed -> evaluate -> publish or reject |
| 3.11.4 | Implement parser router | 12h | TS | Native parsers, Unstructured client | 1.2.5, 1.2.6 | Routes by file type, size, OCR need, layout complexity, language |
| 3.11.5 | Implement native structured data parsers | 12h | TS | csv-parse, JSON/YAML/XML parsers | 3.11.4 | CSV, JSON, JSONL, YAML, XML become structured nodes |
| 3.11.6 | Implement incremental re-indexing | 14h | TS + WASM | Artifact hashes, chunker, JobQueue | 3.10.5 | Changed documents only rebuild affected artifacts/nodes/projections |
| 3.11.7 | Implement ingestion smoke evaluation | 8h | TS | Evaluation runner | 3.10.4, 1.4.6 | Compilation can block publish when smoke eval fails |

**Sprint 11 Total**: ~80h

### Sprint 12: Bulk Operations + Lifecycle (Week 23-24)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 3.12.1 | Implement bulk upload API | 10h | TS | Hono, JobQueue | 3.10.5 | Creates many compilation jobs and a bulk job id |
| 3.12.2 | Implement bulk delete API | 10h | TS | Hono, JobQueue, Drizzle | 3.12.1 | Cascades document deletion through derived artifacts |
| 3.12.3 | Implement bulk reindex API | 8h | TS | Hono, JobQueue | 3.12.1, 3.11.6 | Supports all documents or filtered subset |
| 3.12.4 | Implement bulk progress API | 6h | TS | Hono, Drizzle | 3.12.1 | Returns total/completed/failed item counts |
| 3.12.5 | Implement retention policy config | 8h | TS | Drizzle, Hono | 1.1.7 | Per-tenant/space retention settings exist |
| 3.12.6 | Implement cascading deletion | 12h | TS | Drizzle, S3 adapter, cache invalidation | 3.12.5 | Deletes raw assets, artifacts, nodes, projection rows, caches, trace redactions |
| 3.12.7 | Implement cleanup jobs | 10h | TS | JobQueue | 3.12.5 | Expired artifacts, projections, sessions, traces, task results are cleaned |
| 3.12.8 | Implement storage quotas | 8h | TS | Drizzle, object storage metadata | 3.12.5 | Upload rejects with clear quota error |
| 3.12.9 | Document Temporal-compatible interface | 4h | TS | Markdown | 3.10.1 | Future Temporal adapter boundary is documented; not implemented |

**Sprint 12 Total**: ~76h

### Phase 3 Milestone

```text
Durable JobQueue adapter for Cloudflare and Standalone
Versioned DocumentCompilationJob
IndexProjection versioning
Blue-green publish and rollback
Embedding model registry and upgrade flow
Parser router with native TypeScript structured parsers
Incremental re-indexing
Ingestion smoke evaluation
Bulk upload/delete/reindex
Retention, quotas, cascading deletion, cleanup jobs
Temporal adapter boundary documented
```

---

## Phase 4: Advanced Knowledge Compiler

**Duration**: 8 weeks (Sprint 13-16)

**Goal**: Improve retrieval quality with contextual enrichment, summary trees, entity/relation extraction, graph index, semantic views, structured document retrieval, and stronger generation verification.

### Sprint 13: Contextual Enrichment + Summary Tree (Week 25-26)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 4.13.1 | Implement contextual enrichment provider flow | 14h | TS | LLM provider, JobQueue, Zod | 1.3.4, 2.7.1 | Nodes can receive contextual descriptions with provider-agnostic LLM calls |
| 4.13.2 | Implement enrichment cost controls | 8h | TS | Budget policy, cache | 4.13.1 | Skip conditions, budget limits, quality threshold, cache reuse |
| 4.13.3 | Implement hierarchical summary tree builder | 16h | TS | LLM provider, Drizzle, JobQueue | 1.3.4, 2.7.1 | Leaf -> section -> document summaries stored as summary nodes |
| 4.13.4 | Implement summary tree incremental maintenance | 12h | TS | Artifact hashes, JobQueue | 4.13.3, 3.11.6 | Changed branches rebuild without full tree rebuild |
| 4.13.5 | Integrate summary tree retrieval path | 10h | TS | Retrieval planner, DatabaseAdapter | 4.13.3, 2.5.3 | Deep mode can use top-down summary navigation |
| 4.13.6 | Evaluate enrichment and summary tree impact | 6h | TS | Evaluation runner | 4.13.5 | Report compares enriched vs non-enriched retrieval |

**Sprint 13 Total**: ~66h

### Sprint 14: Entity/Relation Extraction + Graph Index (Week 27-28)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 4.14.1 | Implement entity extraction provider flow | 14h | TS | LLM structured output or external NER API | 1.3.4 | Extracts people, orgs, products, dates, policies, terms, metrics |
| 4.14.2 | Implement relation extraction provider flow | 12h | TS | LLM structured output | 4.14.1 | Extracts mentions, defines, references, depends_on, supersedes, contradicts |
| 4.14.3 | Implement extraction quality controls | 10h | TS | Confidence thresholds, dedup, budget policy | 4.14.1, 4.14.2 | Low confidence is stored but excluded from graph/semantic views |
| 4.14.4 | Design graph schema | 8h | TS | Drizzle, PostgreSQL/TiDB recursive CTE | 4.14.3 | Entity and relation tables support traversal queries |
| 4.14.5 | Write graph index from extraction outputs | 10h | TS | Drizzle, JobQueue | 4.14.4 | Entity/relation batches are versioned and traceable |
| 4.14.6 | Implement graph traversal | 12h | TS | DatabaseAdapter recursive CTE | 4.14.5 | 2-hop expansion has depth, fanout, node, and latency budgets |
| 4.14.7 | Integrate graph expansion into deep retrieval | 10h | TS | Retrieval planner | 4.14.6, 2.5.3 | Deep mode merges hybrid recall and graph expansion |
| 4.14.8 | Implement graph incremental maintenance | 8h | TS | JobQueue, Drizzle | 4.14.5 | Deleted/updated docs prune mentions and orphan entities |

**Sprint 14 Total**: ~84h

### Sprint 15: Semantic Views + Structured Retrieval (Week 29-30)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 4.15.1 | Implement KnowledgeFS `/by-entity` | 10h | TS | KnowledgeFS, graph index | 4.14.5, 1.4.1 | Entity virtual directories list related documents |
| 4.15.2 | Implement KnowledgeFS `/by-topic` | 12h | TS | LLM clustering, JobQueue | 4.13.3 | Topic virtual directories materialize asynchronously |
| 4.15.3 | Implement semantic view freshness metadata | 6h | TS | Drizzle, KnowledgeFS | 4.15.1 | Views expose generated version, stale status, build status |
| 4.15.4 | Implement async semantic view materialization | 10h | TS | JobQueue | 4.15.2 | Semantic views build in background without blocking ingestion |
| 4.15.5 | Implement query-dependent virtual trees | 10h | TS | KnowledgeFS, AnswerTrace | 2.6.7 | `/queries/{trace}/evidence`, `/conflicts`, `/missing` are browsable |
| 4.15.6 | Implement table-specific retrieval | 12h | TS | Structured payloads, DatabaseAdapter | 1.3.4 | Tables are independent nodes with JSON/HTML resources |
| 4.15.7 | Implement image/OCR-aware retrieval | 10h | TS | ParseArtifact figures/OCR/captions | 1.2.5 | Figure nodes include OCR text, caption, source location |
| 4.15.8 | Implement semantic diff flow | 10h | TS + WASM | LLM provider, WASM diff | 2.8.3, 4.13.3 | Version diff includes text diff and semantic change summary |

**Sprint 15 Total**: ~80h

### Sprint 16: Verification + UI Polish (Week 31-32)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 4.16.1 | Implement claim-evidence alignment check | 12h | TS | Rule-based fast mode, LLM judge deep/research | 2.7.8 | Ungrounded claims are flagged with evidence references |
| 4.16.2 | Implement hallucination/freshness flags | 8h | TS | Post-processing, metadata | 4.16.1 | Responses include ungrounded and stale evidence metadata |
| 4.16.3 | Add entity browser UI | 12h | Full-Stack | Next.js, React, graph visualization | 4.14.5 | Users can browse entities and linked documents through Hono APIs |
| 4.16.4 | Add semantic view browser UI | 10h | Full-Stack | Next.js, React | 4.15.1, 4.15.2 | Users can browse by topic/entity/freshness through Hono APIs |
| 4.16.5 | Add document diff UI | 10h | Full-Stack | Next.js, React diff viewer | 4.15.8 | Text and semantic diffs render side-by-side |
| 4.16.6 | Phase 4 evaluation report | 8h | TS | Evaluation runner | Phase 4 tasks | Reports graph/enrichment/summary/tree impact on golden set |

**Sprint 16 Total**: ~60h

### Phase 4 Milestone

```text
Contextual enrichment with budget controls
Incremental summary tree
Entity/relation extraction with confidence and dedup controls
PostgreSQL/TiDB-backed graph index through DatabaseAdapter
Graph expansion in deep retrieval
Semantic KnowledgeFS views with freshness metadata
Query-dependent virtual trees
Table and image/OCR-aware retrieval
Semantic diff
Claim-evidence verification and hallucination flags
Entity, semantic view, and diff UI
```

---

## Phase 5: Agent-Native Research

**Duration**: 4 weeks (Sprint 17-18)

**Goal**: Enable reliable, auditable, long-running research workflows for agents and advanced users.

### Sprint 17: Research Task Lifecycle (Week 33-34)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 5.17.1 | Implement ResearchTaskJob state machine | 12h | TS | JobQueue, Drizzle | 3.10.4 | queued -> planning -> retrieving -> analyzing -> generating -> completed |
| 5.17.2 | Implement research task API | 10h | TS | Hono, JobQueue | 5.17.1 | Create, get, cancel endpoints work |
| 5.17.3 | Implement partial results | 8h | TS | EvidenceBundle storage | 5.17.1 | Accumulated evidence is fetchable during and after cancellation |
| 5.17.4 | Implement research task cost tracking | 8h | TS | Provider price registry | 5.17.1 | Cost checked after each step; budget exhaustion cancels with partials |
| 5.17.5 | Implement dry-run research planning | 10h | TS | Cost estimator, retrieval planner | 5.17.1, 2.8.7 | Estimates scanned resources, tool calls, token usage, latency, cost, cache hit probability |
| 5.17.6 | Implement limits enforcement | 6h | TS | Policy middleware | 5.17.1 | Enforces timeout, retrieval steps, scanned docs, tool calls |
| 5.17.7 | Implement task resumability | 10h | TS | JobQueue, durable artifacts | 5.17.1 | Restart resumes from last persisted state |
| 5.17.8 | Implement AgentWorkspaceSnapshot model | 10h | TS | Drizzle, object storage, trace registry | 2.6.7, 1.4.3 | Snapshot captures mounts, source versions, permission snapshot, index projection, command log, evidence bundles |
| 5.17.9 | Implement research MCP tools | 10h | TS | MCP SDK | 5.17.2, 5.17.5 | Agent can plan/create/get/cancel research tasks |
| 5.17.10 | Implement workspace snapshot MCP/API tools | 8h | TS | MCP SDK, Hono | 5.17.8 | Agent can create/get workspace snapshots |
| 5.17.11 | Implement SSE/Webhook progress | 8h | TS | Hono SSE, webhook adapter | 5.17.1 | Agents can subscribe to task progress |

**Sprint 17 Total**: ~100h

### Sprint 18: Source Comparison + Conflict + Backpressure (Week 35-36)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 5.18.1 | Implement source comparison | 12h | TS | LLM provider, EvidenceBundle | 2.6.2 | Compares evidence items and returns structured comparison report |
| 5.18.2 | Implement conflict detection | 12h | TS | LLM judge, graph index | 5.18.1, 4.14.6 | Returns conflicts with source locations |
| 5.18.3 | Implement freshness checking | 6h | TS | Metadata filters | 2.6.2 | Evidence items return stale warnings |
| 5.18.4 | Implement budgeted research workflow | 16h | TS | JobQueue, retrieval runtime, LLM provider | 5.17.1, 5.18.1, 5.18.2 | Multi-step retrieve -> compare -> conflict -> cite -> report workflow runs |
| 5.18.5 | Implement backpressure automation | 10h | TS | Metrics, middleware, JobQueue | 2.8.11 | High latency downgrades deep/research and pauses low-priority research tasks |
| 5.18.6 | Implement research pause/resume | 8h | TS | JobQueue | 5.18.5 | Research tasks pause under load and resume later |
| 5.18.7 | Implement workspace replay | 12h | TS | AgentWorkspaceSnapshot, trace API | 5.17.8 | A snapshot can replay command log and compare current vs original outputs |
| 5.18.8 | Implement isolated A2A adapter skeleton | 10h | TS | A2A spec, Hono | 5.17.2 | A2A agent card and task endpoint exist outside core contracts |
| 5.18.9 | Agent research E2E test | 8h | TS | MCP client, Vitest | Phase 5 tasks | Agent plans task, creates task, snapshots workspace, gets partial evidence, receives cited report |

**Sprint 18 Total**: ~94h

### Phase 5 Milestone

```text
Research task lifecycle
Partial results and resumability
Dry-run planning
Workspace snapshots and replay
Research MCP tools
SSE/Webhook progress
Source comparison
Conflict detection
Freshness checking
Budgeted multi-step research workflow
Backpressure and pause/resume
Experimental isolated A2A adapter
```

---

## Phase 6: Evaluation Platform

**Duration**: 4 weeks (Sprint 19-20)

**Goal**: Expand the Phase 1-2 evaluation loop into a full quality governance platform.

### Sprint 19: Advanced Metrics + Auto Question Generation (Week 37-38)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 6.19.1 | Build golden question management UI | 12h | Full-Stack | Next.js, React | 2.9.1, 1.4.7 | CRUD golden questions and expected evidence |
| 6.19.2 | Implement automatic question generation | 14h | TS | LLM provider, review workflow | 1.3.4, 2.7.1 | Generated QA pairs require human approval before golden set inclusion |
| 6.19.3 | Implement advanced retrieval metrics | 14h | TS | Evaluation runner, LLM-as-judge | 1.4.8 | Context precision, relevance, faithfulness, citation accuracy |
| 6.19.4 | Build evaluation dashboard | 12h | Full-Stack | Next.js, React, chart library | 6.19.1, 6.19.3 | Shows pass rate, recall trend, citation trend, cost/latency |
| 6.19.5 | Implement production bad-case capture | 10h | Full-Stack + TS | Next.js, Hono API client, Drizzle via Hono | 6.19.1, 2.9.5 | UI can add failed query to eval queue with trace/evidence context |

**Sprint 19 Total**: ~62h

### Sprint 20: A/B Experiments + Annotation + Final Polish (Week 39-40)

| # | Task | Effort | Owner | Tech Stack | Depends On | Done Criteria |
|---|---|---:|---|---|---|---|
| 6.20.1 | Implement A/B strategy comparison | 14h | TS | Evaluation runner, strategy registry | 6.19.3 | Same golden set runs against two retrieval strategies |
| 6.20.2 | Build Retrieval Studio comparison UI | 14h | Full-Stack | Next.js, React | 6.20.1, 2.9.6 | Side-by-side candidates, rerank results, evidence bundles |
| 6.20.3 | Implement human annotation workflow | 12h | Full-Stack + TS | Next.js, Hono API client | 6.19.1 | Annotators mark evidence relevance and answer correctness |
| 6.20.4 | Implement trace comparison UI | 10h | Full-Stack | Next.js, React | 2.9.6 | Compares two query traces for recall/rerank/evidence differences |
| 6.20.5 | Implement failed query diagnostics | 10h | Full-Stack + TS | Next.js, trace API client | 6.20.2 | Explains candidate ranking, filter exclusions, rerank drops |
| 6.20.6 | Harden CI regression blocking | 8h | DevOps + TS | GitHub Actions, evaluation runner | 2.9.7, 6.19.3 | Recall/faithfulness/citation thresholds block merges |
| 6.20.7 | Final documentation | 10h | All | Markdown, OpenAPI | All | API reference, deployment guide, operator manual complete |

**Sprint 20 Total**: ~78h

### Phase 6 Milestone

```text
Golden question management UI
Automatic question generation with human review
Advanced retrieval and faithfulness metrics
Evaluation dashboard
A/B strategy comparison
Retrieval Studio
Human annotation workflow
Failed query diagnostics
CI quality gates
Complete API/deployment/operator docs
```

---

## Risk Register

| # | Risk | Impact | Probability | Mitigation |
|---|---|---|---|---|
| R1 | Embedding API cost grows linearly with corpus size | High | High | Embedding cache, incremental re-indexing, model registry, cost dashboards |
| R2 | Workers memory/CPU limits affect large artifacts or WASM modules | Medium | Medium | Keep WASM modules small, process parsed artifacts in pages, move parsing to Unstructured API |
| R3 | Cross-region DB access hurts retrieval latency | High | Medium | Hyperdrive, cache hot paths, reduce round trips, place DB near Workers where possible |
| R4 | Database-native vector/FTS limits appear at scale | Medium | Medium | Database capability descriptor, performance gates, optional future search backend adapter |
| R5 | CJK FTS quality varies by backend | High | Medium | Early CJK golden set, pg_jieba/pg_bigm validation, TiDB parser validation |
| R6 | Contextual enrichment and extraction costs grow too quickly | Medium | High | Skip conditions, per-space budgets, batch optimization, cache reuse |
| R7 | Entity/relation extraction creates noisy graph | Medium | Medium | Confidence threshold, dedup, extraction scope policy, human review path |
| R8 | Unstructured service instability delays ingestion | Medium | Medium | Health checks, retries, queue visibility, native TS fallback for simple formats |
| R9 | Permission cache staleness leaks data | Critical | Low | Permission snapshot version in cache keys, invalidation tests, trace redaction tests |
| R10 | Architecture drift reintroduces non-portable service code | High | Medium | Enforce architecture guardrails in review checklist and CI dependency checks |

---

## Technology Summary by Phase

| Phase | TypeScript Scope | Rust WASM Scope | External Services | Focus |
|---|---|---|---|---|
| Phase 1 | Hono, Zod, Drizzle, S3 adapter, MCP SDK, auth, parser clients, retrieval MVP | chunker, tokenizer | PostgreSQL/pgvector, TiDB candidate, Unstructured, R2/MinIO, embedding APIs | Core loop |
| Phase 2 | Hono retrieval planner, reranker/LLM providers, SSE, KnowledgeFS, SourceFS, EvidenceFS, CommandRegistry, safe shell, MCP tools, cache, rate limit; Next.js Admin UI consuming Hono clients | RRF fusion, evidence packer, diff | Rerank APIs, LLM APIs, KV/Redis | Production retrieval |
| Phase 3 | JobQueue adapters, pg-boss, Cloudflare Queues/DO wiring, parser router, lifecycle APIs | Existing modules reused | Cloudflare Queues, Durable Objects, Unstructured | Durable ingestion |
| Phase 4 | Enrichment, summary tree, graph schema/traversal, semantic views, structured retrieval | Existing diff/packer reused | LLM/extraction providers | Advanced compiler |
| Phase 5 | Research task workflow, dry-run planning, workspace snapshot/replay, MCP research tools, A2A adapter, backpressure | Existing modules reused | LLM providers, webhook targets | Agent research |
| Phase 6 | Evaluation runner, dashboards, annotation, Retrieval Studio, CI gates | Existing modules reused | LLM-as-judge providers | Quality governance |

---

## Sprint Calendar

| Sprint | Phase | Weeks | Focus |
|---|---|---|---|
| Sprint 1 | Phase 1 | W1-2 | Project skeleton + data model |
| Sprint 2 | Phase 1 | W3-4 | Gateway + basic ingestion |
| Sprint 3 | Phase 1 | W5-6 | Chunking + indexing + retrieval |
| Sprint 4 | Phase 1 | W7-8 | KnowledgeFS + evaluation MVP + E2E |
| Sprint 5 | Phase 2 | W9-10 | Hybrid retrieval + reranking |
| Sprint 6 | Phase 2 | W11-12 | EvidenceBundle + permission + trace |
| Sprint 7 | Phase 2 | W13-14 | Generation + streaming |
| Sprint 8 | Phase 2 | W15-16 | KnowledgeFS/SourceFS tools + CommandRegistry + safe shell |
| Sprint 9 | Phase 2 | W17-18 | Human UX + CI regression |
| Sprint 10 | Phase 3 | W19-20 | Job runtime + versioned ingestion |
| Sprint 11 | Phase 3 | W21-22 | Blue-green publishing + parser router |
| Sprint 12 | Phase 3 | W23-24 | Bulk operations + lifecycle |
| Sprint 13 | Phase 4 | W25-26 | Enrichment + summary tree |
| Sprint 14 | Phase 4 | W27-28 | Entity/relation + graph |
| Sprint 15 | Phase 4 | W29-30 | Semantic views + structured retrieval |
| Sprint 16 | Phase 4 | W31-32 | Verification + UI polish |
| Sprint 17 | Phase 5 | W33-34 | Research lifecycle + dry-run + snapshots |
| Sprint 18 | Phase 5 | W35-36 | Comparison + conflict + replay + backpressure |
| Sprint 19 | Phase 6 | W37-38 | Advanced metrics + question generation |
| Sprint 20 | Phase 6 | W39-40 | A/B, annotation, final docs |

---

## Key Decision Points

| When | Decision | Options | Criteria |
|---|---|---|---|
| Sprint 3 end | PostgreSQL vs TiDB capability validation | PostgreSQL standalone; TiDB SaaS | Vector + FTS + metadata filters meet latency and quality targets |
| Sprint 5 end | Reranker default provider | Cohere, Voyage, Jina, other API provider | Quality uplift, latency, cost, multilingual/CJK behavior |
| Sprint 9 end | Continue to Phase 3 or extend retrieval hardening | Move on; extend Phase 2 | Golden recall, citation accuracy, latency, permission tests meet thresholds |
| Sprint 12 end | Add Temporal adapter or stay with adapter-backed queues | Stay with queues; add Temporal adapter later | Job failure rate, compensation needs, workflow complexity |
| Sprint 14 end | Keep graph in unified DB or introduce dedicated graph backend later | PostgreSQL/TiDB recursive CTE; future graph DB | Entity count, edge count, traversal latency, query complexity |
| Sprint 16 end | Enter Phase 5 or deepen compiler quality | Agent research; compiler polish | Agent integration demand and Phase 4 eval gains |
