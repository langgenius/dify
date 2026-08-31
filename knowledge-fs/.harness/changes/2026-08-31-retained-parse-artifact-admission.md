# Retained parse-artifact admission

## What changed

- Added a process-local FIFO admission for canonical `ParseArtifact` objects retained after source
  materialization. It independently limits live artifact count and a conservative aggregate byte
  charge.
- Added an in-place, capped estimator that charges UTF-16 strings and container/property overhead
  without `JSON.stringify`, cloning, or allocating a second artifact representation.
- Fresh and resumed compilations acquire the retained-artifact lease before releasing the shared
  materialization slot, then hold it across outline, semantic, graph, reindex, publication, and
  smoke-evaluation consumers. Success, failure, and cancellation release it in `finally`.
- The API assembly constructs one singleton admission shared by every per-attempt worker in the
  process. Directly constructed workers use a safe module singleton as well.
- Added operator settings:
  - `KNOWLEDGE_DOCUMENT_RETAINED_ARTIFACT_MAX_CONCURRENCY` (default `4`, range `1..32`)
  - `KNOWLEDGE_DOCUMENT_RETAINED_ARTIFACT_MAX_BYTES` (default `134217728`, range 1 MiB..1 GiB)
- Wired the settings into the service env example, local Compose, local env example, Kubernetes
  baseline, and production/local operator documentation. Dify Compose does not inject either value
  through `service.environment`, so an operator-owned `knowledge-fs.env` remains authoritative.

## Why

The source materialization gate previously released as soon as a canonical artifact was returned.
The durable runtime can claim ten compilations, allowing multiple parser responses (up to 32 MiB
serialized each) to remain live simultaneously during slower outline, semantic, graph, and index
stages. This created a cross-format OOM risk even though parsing itself was bounded.

The two-dimensional admission preserves useful concurrency for small documents while preventing a
few large canonical artifacts from multiplying heap use. An artifact charged at the whole byte
budget waits until it can run exclusively rather than deadlocking. The fixed lock order is
materialization then retained-artifact; downstream work never reacquires materialization.

## Verification

- TDD red phase observed for the new admission module, worker lifecycle integration, resume path,
  compilation environment parsing, and deployment assertions.
- `pnpm --dir knowledge-fs --filter @knowledge/api exec vitest run src/document-compilation-worker.test.ts src/retained-parse-artifact-admission.test.ts` — 41 passed.
- Focused retained-admission coverage — 100% statements, 90.41% branches, 100% functions,
  100% lines.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app exec vitest run src/document-compilation-options.test.ts` — 7 passed.
- `pnpm --dir knowledge-fs exec node --test scripts/compose-apps.test.mjs` — 14 passed.
- `pnpm --dir knowledge-fs --filter @knowledge/api typecheck` — passed.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app typecheck` — passed.
- `pnpm --dir knowledge-fs --filter @knowledge/api test` — 4,762 passed, 3 skipped.
- `pnpm --dir knowledge-fs --filter @knowledge/api-app test` — 286 tests passed after the
  format-aware parser policy and buffered-upload integration were finalized.
- Biome focused check/write for the changed API worker/admission files — passed.
- `git diff --check` — passed after the final code, configuration, and documentation changes.

## Risks and follow-up

- The byte charge is intentionally conservative but remains an estimate of V8 retention, not an
  exact heap measurement. It excludes transient allocations inside downstream providers, which
  retain their own independent concurrency and batch limits.
- Admission is process-local. A multi-replica deployment must multiply the configured envelope by
  replica count; a future cluster-wide memory coordinator would be a separate design.
- The materialization-to-retention handoff can keep up to the bounded materialization concurrency
  waiting behind a large retained artifact. This is deliberate: it prevents an unbounded queue of
  already-materialized objects, and there is no reverse gate acquisition path.
