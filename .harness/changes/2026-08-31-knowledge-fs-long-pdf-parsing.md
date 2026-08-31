# KnowledgeFS bounded long-PDF parsing

## What changed

- Added process-local single-flight coordination for identical Unstructured requests. Cancellation
  removes work that is still waiting for admission, while an already-started transport is allowed
  to settle before the caller is released. Heavy-document admission is nested outside the
  process-wide gate so a queued heavy request cannot consume ordinary remote-parser capacity.
- Added execution-scoped durable lease protection around remote parser calls. The database attempt
  and outbox remain fenced for the parser deadline plus bounded grace, while broker heartbeats stay
  at their normal short lease. A result is checkpointed only after the worker reasserts ownership.
  Explicit provider responses can release protection; timeout and ambiguous network outcomes do
  not launch an overlapping retry.
- Added migration `0047_parse_artifact_checkpoints` for policy-keyed raw Unstructured artifacts.
  Completed remote parses can be reused across durable attempts until canonical materialization
  succeeds. Native Markdown, HTML, CSV, JSON, XML, and other native parser routes do not read or
  write the raw checkpoint table.
- Added a document-scoped Poppler session that materializes the source PDF once, reuses page-size
  probes, and releases rendered page buffers before advancing. Cleanup now preserves both the
  primary operation error and any cleanup error. Cancellation removes queued render, session, and
  materialization work before it acquires a concurrency slot; already-active work still settles
  and cleans up before the caller is released.
- Added an opt-in `knowledge-fs-unstructured` Dify Compose profile so KnowledgeFS can use a
  page-parallel Unstructured service without changing the existing `unstructured` profile or
  legacy Dify ETL traffic.
- Pinned the isolated parser to the tested multi-platform image digest
  `sha256:0df934a22e4e893cf15e7aeaf35c463ecc75937758a83099aefdc13041619a1d` and capped it
  at four CPUs and 6 GiB.
- Kept ordinary remote parser requests at two concurrent requests with a 600-second (10-minute)
  timeout. PDFs and other structurally heavy documents use a nested one-request gate and a
  2,400-second timeout.
- Added a tracked required defaults file for service-side split/thread settings, followed by an
  optional operator override file. Clean checkouts can therefore run Compose validation without
  generating an ignored required file.
- Kept standalone developer-harness host and container endpoints separate:
  `http://127.0.0.1:8000` for a source-run API and `http://unstructured:8000` for the API container.

## Representative measurements

These are representative samples, not a complete-document ingestion benchmark:

- A 12-page sample (source pages 8–11, 38–41, and 118–121) took `169.644325 s` with one `hi_res`
  request and `90.228331 s` with six-page splits and two child threads, a measured reduction of
  `46.813%`. The raw JSON was byte-for-byte identical: 124 elements, all 12 pages, 12 tables with
  HTML, and coordinates on all 124 elements.
- An 18-page sample (source pages 8–13, 38–43, and 118–123) took `143.516036 s` with two threads and
  `116.074878 s` with three threads, a measured reduction of `19.121%`. The raw JSON was
  byte-for-byte identical: 194 elements, all 18 pages, 12 tables, and coordinates on all 194
  elements.
- The three-thread run peaked at `390.36%` CPU and `2.916 GiB` parser RSS on a host using
  `7.632 GiB`. Those measurements support the one-outer-request, four-CPU, 6-GiB deployment bound;
  they do not prove behavior under arbitrary concurrent workloads.
- A Poppler session benchmark used five representative pages (1, 105, 150, 230, and 295) across
  six alternating rounds. Median wall time was `1058.096 ms` before and `1050.725 ms` after. The
  source PDF was materialized once instead of five times (`3,352,759` versus `16,763,795` bytes),
  while output bytes remained identical at `1,352,369`.

The complete approximately 295-page report was **not** run end to end after these changes. A
`31.706 min` full-document duration is only a conservative linear projection from the sample, not
an observed result. The 40-minute PDF timeout therefore represents an estimated `8.294 min` of
headroom and must not be reported as measured end-to-end performance.

## Compatibility and operations

- The legacy `unstructured` service definition, image tag, profile, volume, and behavior are
  unchanged.
- The isolated service is internal-only at `http://knowledge_fs_unstructured:8000`; no host port is
  published.
- An external Unstructured-compatible endpoint remains supported through `UNSTRUCTURED_API_URL`.
- The upstream synchronous API has no cancellation or idempotency contract. A timed-out request can
  leave remote child work running, so Unstructured transport timeouts are not automatically
  retried.
- Kubernetes does not receive an implicit parser deployment. Its baseline retains generic limits
  unless operators deploy and benchmark an equivalent isolated parser.
- Existing databases must apply migration `0047_parse_artifact_checkpoints` before the new API
  image starts. Roll back the application before making any schema change. The checkpoint table is
  derived retry state and may be left in place safely; if an operator needs a schema rollback, it
  can be dropped after every newer API instance has stopped without affecting canonical parse
  artifacts or published document revisions.
- Raw checkpoints are deleted after successful canonical materialization. A terminal downstream
  failure keeps one checkpoint per asset/version for a later manual retry; there is currently no
  TTL or background checkpoint collector. Document deletion cascades and version pruning reclaim
  these rows, and operators should monitor `parse_artifact_checkpoints` growth until a retention
  collector is added.

For the bundled Dify deployment, copy the KnowledgeFS service example and start the dedicated
profile explicitly:

```sh
cd docker
cp envs/core-services/knowledge-fs.env.example envs/core-services/knowledge-fs.env
docker compose --profile knowledge-fs-unstructured config
docker compose --profile knowledge-fs-unstructured up -d
```

## Verification

- Dify Compose generation and `knowledge-fs-unstructured` profile configuration.
- Local full-stack and middleware Compose configuration.
- Compose contract tests for isolation, pinned digest, environment precedence, limits, and resource
  ceilings.
- KnowledgeFS workflow-path and secret-scan tests.
- Parser coverage and type checks, API/database/adapter test suites, migration artifact validation,
  and generated KnowledgeFS contract validation.
