# Visual embedding memory bounds

## What changed

- Split object-backed visual embedding into sequential microbatches bounded by both asset count and
  retained raw-image bytes. Defaults are eight images and 32 MiB per physical request.
- Added a conservative pre-read admission rule: a pending batch is flushed when its remaining byte
  budget cannot hold another maximum-sized accepted asset. Each image then uses a bounded object
  stream instead of serial HEAD plus a broader buffered GET. The stream is canceled as soon as the
  next chunk would exceed the image limit, and only a proven-valid body is concatenated.
- Added per-physical-call document model budget admission and provider-call accounting. A later
  microbatch failure reports the number of requests actually attempted and persists no projection
  vectors from earlier microbatches.
- Aggregate results retain source asset order, sum complete token usage, and reject model,
  provider, vector-dimension, or physical-call identity drift between microbatches.
- Added one cancel-aware, process-wide visual lifecycle gate. At the default concurrency of two,
  queued documents wait before reading any object and release their slot on success or failure.
- Moved the visual success metric after response validation and projection persistence. Validation,
  cancellation, schema, and repository failures now emit one failed metric rather than a premature
  success.
- Added optional service settings
  `KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS` and
  `KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES`, and
  `KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY` plus deployment guidance.

## Why

The projection reindexer may supply up to 128 visual candidates at once. The previous adapter read
every accepted object (up to 20 MiB each) before invoking Dify model runtime, where all images were
then base64 encoded together. That made peak memory proportional to the whole projection batch and
could exhaust the API process for image-heavy documents of any source format.

## Verification

- TDD red phase reproduced the unbounded single request, one logical budget reservation for
  multiple physical calls, missing option validation, vector-dimension drift, admission-hook
  bypass, three concurrently active document lifecycles, a queued cancellation that still read its
  object, a failure that did not protect the next caller's read, buffered GET/HEAD usage for every
  image, an uncanceled oversized stream, and success metrics emitted before validation/persistence.
- Focused API package tests cover exact count/byte batches, measured retained raw bytes, result
  ordering, bounded stream cancellation, zero visual HEAD/buffered-GET calls, missing/failed stream
  skips, unreadable/oversized skips, thumbnail fallback, aborts, usage aggregation, budget and
  metrics accounting through validation/persistence, provider failures, and cross-batch identity
  validation: 49 tests passed.
- Focused API-app tests cover environment validation, the exact Dify request split, three callers
  capped at two active lifecycles, cancellation before queued object reads, and release after a
  provider failure: 9 tests passed. The complete API-app suite passed before the final focused gate
  additions: 278 tests.
- Deployment configuration regression tests passed: 14 tests.
- `@knowledge/api` and `@knowledge/api-app` typechecks passed after the bounded-stream and metric
  changes. Biome passed for the changed visual implementation and tests; `git diff --check` passed
  for every visual implementation, test, documentation, change-note, and deployment-config file.
- The full `@knowledge/api` coverage runner completed without a test failure and measured `89.31%`
  aggregate branch coverage versus a recorded clean-HEAD baseline of `89.27%`. The package-wide
  threshold is therefore a pre-existing baseline issue, not a regression introduced by this slice;
  the visual implementation measured above 90% branch coverage in the combined report.
- The repository-wide `pnpm check`, `pnpm build`, and `pnpm lint` are deferred to root integration
  because other agents are concurrently modifying parser, worker, Compose, and deployment files in
  the same worktree.

## Known risks and follow-up

- `MAX_BATCH_BYTES` bounds retained raw image bodies, not the transient base64 and JSON transport
  representation. Operators should keep global model-runtime concurrency bounded and lower the raw
  byte limit on memory-constrained replicas.
- A valid multi-chunk stream may temporarily retain its bounded source chunks and one bounded
  contiguous destination while finalizing the image; oversized streams are canceled before this
  concatenate. Conservative preflush makes this raw assembly peak no greater than
  `MAX_BATCH_BYTES + MAX_ASSET_BYTES` per active lifecycle (52 MiB with the defaults), and the
  visual lifecycle gate bounds the number of simultaneous peaks across documents.
- Object-storage adapters used for production visual embedding must implement `getObjectStream` as
  a true stream. The Dify adapter forwards response chunks and propagates cancellation without an
  intermediate whole-body concatenate; a custom adapter that buffers before returning its stream
  cannot inherit this consumer-side memory guarantee.
- The conservative preflush policy may underfill a request when the configured per-image limit is
  much larger than actual thumbnails; this trades some request throughput for the raw-byte bound.
