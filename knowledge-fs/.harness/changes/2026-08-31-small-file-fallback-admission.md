# Buffered upload fallback admission

## What changed

- Added one fair, cancel-aware, process-local admission gate for the upload-session
  `small_fallback` path.
- The gate enforces two independent budgets across unrelated upload requests:
  - active request count (`2` by default, configurable from `1` through `8`);
  - aggregate admitted source bytes (`31457280`, or 30 MiB, by default; at least the configured
    per-file fallback limit and no more than 100 MiB).
- The HTTP handler acquires admission before allocating its exact-size `Uint8Array`, holds the
  reservation through checksum verification and the Dify object-storage write, then releases it
  before document publication begins.
- A request cancelled while queued is removed without running its body-read/allocation callback.
  Active body reads share the direct-upload 30-second idle and 10-minute total deadlines; timeout
  or client abort cancels the reader. Failures release both budgets before the next FIFO waiter is
  admitted, so two stalled clients cannot exhaust the fallback path indefinitely.
- The API application creates the gate once and passes that singleton through gateway wiring, so
  all buffered fallback requests handled by one API process share the same budgets.
- Added image defaults, Dify operator env defaults, local Compose/env defaults, and Kubernetes
  baseline values. Dify Compose deliberately does not place the two new variables in
  `service.environment`, so an operator's `knowledge-fs.env` remains authoritative.
- Kept the existing 15 MiB per-file upload/fallback envelope unchanged.
- Added the corresponding process-local admission boundary to the Dify Console BFF, which was
  previously able to buffer every concurrent multipart request before the KnowledgeFS API gate
  could apply backpressure. One shared FIFO gate now covers all three buffered BFF paths:
  workspace staging (`/knowledge-fs/uploads`), legacy multipart `createDocument`, and upload-session
  `small-file` fallback. It is acquired only after login/capability authorization, before the first
  body read, and is held through Dify storage or the KnowledgeFS remote write plus response
  validation.
- The BFF defaults remain two concurrent 15 MiB reservations and 30 MiB aggregate reserved source
  bytes per process. A configured paid-plan upload limit larger than 30 MiB is admitted exclusively
  instead of failing with HTTP 500 or waiting forever; ordinary 15 MiB requests keep the strict
  `2 x 15 MiB` envelope.
- A workspace whose configured upload limit is zero now receives the existing request-too-large
  (`413`) product error before admission or body read, rather than leaking the gate's invalid
  reservation error as HTTP 500.
- Buffered BFF requests reissue their short-lived capability after a long admission wait and again
  after a slow body read when fewer than 15 seconds remain. Authorization still happens before any
  body is consumed, while the final remote call always uses a fresh token and its matching resolved
  space/path instead of failing because a queued 60-second capability expired.

## Why

The integrated Dify object-storage adapter intentionally does not expose provider-direct presign
or multipart primitives. A fallback upload therefore allocates the full request body, hashes it,
and may be copied again by the storage adapter. The per-file 15 MiB cap did not protect one API
process from many simultaneous requests, so concurrent uploads could amplify transient heap use
and cause an out-of-memory restart. Count-only admission would still allow an unsafe aggregate for
large requests, while byte-only admission would allow excessive tiny-request fan-out; both budgets
are required.

## TDD and verification

- RED reproduced the missing protection:
  - the new admission module could not be imported;
  - the handler lifecycle test observed storage/publication without an admission boundary;
  - deployment tests rejected the missing env and image defaults.
- GREEN verification:
  - `@knowledge/api` focused admission + handler tests cover queued/active cancellation and two
    stalled readers releasing their slots;
  - focused new-module coverage: 100% statements/lines/functions and 91.89% branches;
  - `@knowledge/api-app` upload options/assembly tests: 9 passed;
  - Compose and API image artifact tests: 17 passed;
  - `@knowledge/api` typecheck: passed;
  - `@knowledge/api-app` typecheck: passed;
  - Biome check on all changed TypeScript/JavaScript files: passed.
  - local Compose configuration (including the `apps` profile): valid.
  - Dify BFF focused facade/controller/admission tests: 130 passed;
  - Dify BFF Ruff formatting/lint, targeted mypy, and targeted Pyrefly: passed.

## Risks and follow-up

- Admission is process-local. Deployment-wide admitted bytes scale with API replica count; capacity
  planning must multiply each service's configured budget by its replica count. The Dify BFF and
  KnowledgeFS API have separate process-local gates because they are separate processes. A
  distributed semaphore is a separate follow-up if cluster-wide admission becomes necessary.
- `MAX_RESERVED_BYTES` tracks source payload bytes, not exact V8 heap bytes. Hashing, Dify transport,
  and adapter copies can temporarily multiply that value, but the number and aggregate size of
  requests allowed to enter that amplification window are now bounded.
- The gate intentionally ends after `putObject` completes. Publication and compilation do not
  retain the upload body and must not consume scarce buffered-upload admission.
