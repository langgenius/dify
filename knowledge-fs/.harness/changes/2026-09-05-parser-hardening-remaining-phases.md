# Parser hardening: remaining phases

## Scope and sequence

Follow-up to `2026-09-05-parser-hardening-phase-one.md` and the all-format parser audit.
Existing uncommitted phase-one changes are preserved. No production deployment or migration
is part of this implementation turn.

1. Execution contracts: shared format registry, strict text decoding, properties/VTT semantics;
   bounded cancellable native child processes; opt-in dedicated Unstructured request isolation
   and nested mail/archive admission.
2. Completeness/reuse: immutable media execution plan, sync/durable capability parity,
   aggregate remote media budgets, explicit skipped/partial coverage, backend semantic revision.
3. Evaluation: real native golden/resource benchmark, separate preview/analysis variants,
   dedicated provider image golden gate and resource/cancellation tests.

## Native execution boundary

The Node API wraps native parsers in one shared admission controller (2 active processes,
32 queued requests, 128 MiB total reserved input, 50 MiB absolute input ceiling further
restricted by the existing API input setting). Each request receives a fresh process with a
256 MiB V8 old-generation ceiling and a 600-second wall deadline including admission.
Linux additionally samples resident memory every 50 ms and terminates the child above
512 MiB (this sampled check is not a hard RSS quota). The same lifecycle executor isolates
Sharp image variant work with separate 128 MiB V8 / 384 MiB sampled RSS limits, a 30-second
task deadline, 2 active / 8 queued tasks and 64 MiB reserved input. Each document also has
an aggregate image/variant work budget; independent task limits cannot reset that budget.
Cancellation/timeout sends SIGKILL; admission is released only on process close. The process
receives no provider credentials or inherited NODE_OPTIONS. Serialized output is capped at
32 MiB; peak RSS, parser elapsed time and input/output bytes are added to artifact metadata,
not semantic artifact identity. This is process isolation plus bounded allocation, **not** a
claim that V8 heap size is a hard OS RSS limit or that Node processes form a security sandbox.

Production builds include a compiled `native-parser-worker.mjs` (no production tsx). The image
bundle smoke now executes a native parsing request in the child, in addition to Sharp/Poppler.
It also executes the compiled image-variant worker. Worker responses are validated at the
parent boundary. Unexplained process exits and malformed IPC are operational response
failures, not falsely labelled malformed user documents. Known format rejection remains
an input failure; cancellation retains the original reason, including falsy reasons.

Unsafe or budget-rejected original images are retained with a bounded optional
`analysisUnavailable` marker. This marker survives manifest/node/candidate projection and
prevents embedding, enrichment and answer providers from bypassing rejection via an original
image fallback. Legacy artifacts without this optional field retain their previous behavior.

## Verification

- RED: missing isolated adapter; API native route had no process metadata; backend revision
  did not affect API policy fingerprint; image bundle did not include/probe the worker.
- Native process regression tests: real parser content/hash equivalence, real CPU-bound child
  killed on abort, shared slot lifetime, queue/byte admission, deadline, crash and typed errors.
- API parser options tests include configured backend semantic identity and >10 MiB JSON.
- Final native lifecycle/protocol/memory focused gate: 43 tests, 100% statements/lines/functions
  and 96.35% branches across the four implementation modules. Individual module branches
  are also at least 90%; no threshold was relaxed.
- Real native golden benchmark: 10 format families × 2 bounded fixture sizes × 3 repetitions;
  all required Unicode markers preserved. Measures p50/p95, child peak RSS and output amplification.
  Markers are **not** a proxy for OCR accuracy or retrieval recall. Development tsx startup is
  included in latency; do not compare these values to production compiled worker latency.

## Release gates / environment limits

Local Docker CLI exists but the daemon socket is unavailable. Actual pinned Unstructured
image compatibility, legacy binary golden fixtures and multi-replica production capacity are
not validated by local mocked/unit tests. The new provider sandbox must remain opt-in until
its real-image contract gate passes. Do not mark this deployment/quality gate complete merely
because source tests pass. Final verification and remaining external gates will be recorded below.

## Measured local evaluation

- Node 22.23.2 / macOS arm64 native adapter: 10 format families × 10/1,000 rows × 3 runs;
  60 actual isolated parses, required Unicode markers all preserved. Across the 20 cases,
  p50 140–175 ms, p95 142–197 ms and peak child RSS approximately 99–112 MiB. These are
  development tsx-startup-inclusive measurements, not compiled production throughput or OCR
  quality estimates.
- Both compiled workers were separately exercised on Node 22.0.0, including exact large
  JSON integer preservation and real Sharp analysis/thumbnail output. The full API dependency
  graph already contains undici 8.10.0, whose installed engine requires Node >=22.19.0;
  full API compatibility is therefore verified on 22.23.2, not asserted for 22.0.0. No runtime
  dependency was downgraded or updated during this compatibility check.
- Bounded synthetic PDF thumbnail comparison: repeated two-Poppler rendering measured
  95–103 ms, versus 73–83 ms for a shared main bitmap plus Sharp thumbnail (296 ms cold
  run). The output was **not pixel equivalent** (12.54 dB PSNR), and the derived thumbnail
  was larger (7,152 vs 6,115 bytes). The production two-render policy remains unchanged;
  broader OCR, non-Latin, chart and memory measurements are required before replacement.

## Final local gates

- Full `pnpm check` **passed** after final fixes, including workspace typechecking/tests,
  configured CI coverage gates, retrieval and phase-4 evaluations, hermetic OpenAPI export,
  migration artifacts, Compose configuration and static smoke/workflow contracts.
- Parser package: **521 tests passed**, 97.13% statements/lines, 91.50% branches,
  97.97% functions. API package: **5,124 passed, 3 pre-existing skipped** (430 passed files,
  one skipped). API application: **432 tests passed** (57 files). Existing CI aggregate
  coverage excludes the API package; focused changed-module coverage is recorded separately,
  without lowering thresholds or treating unrelated baseline coverage as newly verified.
- Media focused gate: 113 tests, 99.06% lines, 92.70% branches, 100% functions before final
  boundary refinements. Final marker/manifest/enhancer regression gate: 25 passed, followed
  by the complete API suite above. It covers count/byte-skipped large inline sources,
  whitespace-prefixed data URIs, recovery provenance and truthful missing/unsupported states.
- Dedicated provider runtime: **80 tests**, including actual disposable process/descendant
  cancellation, file-locked conversion budgets, sticky signal-death rejection, atomic
  publication and real oxmsg fixture admission; 96.90% statements and 92.05% branches.
  Ruff passes. Both opt-in Compose overlays were configuration-validated.
- `pnpm build`, production esbuild with both worker entry points, backend Biome and
  `git diff --check` pass. Final compiled-worker smoke on Node 22.23.2 preserves a large
  integer, returns a typed invalid-JSON error, and generates both actual Sharp variants.
- Full `pnpm lint` still reports the known unrelated Admin/test/generated-artifact
  formatting and generated OpenAPI size baseline; backend-scoped lint is clean. Those
  unrelated files were not reformatted to manufacture a green global result.
- OpenAPI was regenerated for the additive optional `analysisUnavailable` contract. Contract
  lock generation/validation uses a temporary Git index, preserving the user's staging area.

## Delivery status and outstanding acceptance

The remaining implementation slices are delivered: shared format/native admission contracts,
bounded child execution, nested mail and converted-product admission, capability-aware media
plans, aggregate image work limits, explicit completeness/provenance, backend revision identity,
incremental JSONL/XML admission, preview/analysis separation and reproducible local benchmarks.
Details live in the adjacent format, media and provider change notes.

Not yet accepted: actual pinned Unstructured image build/HTTP golden corpus, read-only image
compatibility, real OCR/table/image recall and localization, production cost-weighted/multi-replica
capacity and a staging canary. Docker is unavailable locally, and no staging deployment was
authorized or performed. Hard per-request cgroup/storage quotas require deployment-level
delegation; process sampling is not equivalent. The legacy synchronous path still has its
documented non-atomic model-head decision; durable production jobs use frozen profiles.

The provider override replaces the existing dedicated service only, never a second per-format
service, and stays opt-in. Existing documents are not automatically re-indexed. No database
migration, production environment mutation, service restart, commit or push occurred.

## Submission follow-up

The subsequent user request authorizes committing and pushing this change. The remote branch
had advanced to `ad43bf7eda`, so the local parser change was replayed on that tip without
rewriting any published commit. Only the generated contract lock conflicted; it was regenerated
against the combined tree. Independent review confirmed that the remote namespace-preview
authentication, website-import recovery, scheduler diagnostics and CI changes remain intact.

After integration, full `pnpm check`, `pnpm build`, production esbuild, backend Biome and secret
scanning pass. API regression now has 5,135 passing tests and the same 3 existing skips; parser
and API-app totals remain 521 and 432. The unmodified provider process suite was not needlessly
rerun. Root `.turbo/`, `artifacts/` and `tmp/` are excluded from the commit. The real-image and
deployment acceptance gates above remain open; committing does not enable the sandbox override.
