# KnowledgeFS Celery execution migration

## Contract

Separate request serving from background execution without rewriting the TypeScript document
pipeline or moving its authoritative state into Redis. Celery owns delivery, worker admission and
process lifecycle; KnowledgeFS retains its database leases, checkpoints, authorization snapshots,
retry policy and immutable publication fences.

Celery tasks must execute the bundled engine locally in their worker Pod, never send long-running
processing requests to a load-balanced KnowledgeFS API. Broker payloads contain typed operation
locators, not documents, credentials, model choices, shell commands or caller-supplied scope.

## Iterations

1. Introduce explicit API/worker execution modes and a registry of bounded background operations.
   Disable every autonomous background scheduler in API-only mode, including gateway-owned
   source, quality and preview schedulers. Preserve embedded mode for existing local deployments.
2. Bridge the compilation outbox and queued findability work to the existing Dify Celery publisher.
   Preserve the outbox delivery identity and handle early delivery, duplicates, retries and worker
   loss without allowing a stale worker to publish.
3. Execute the engine through private worker-local IPC. Restrict operations and envelopes, bound
   input/output, terminate the entire engine process group on cancellation or parent loss, and
   reuse the engine inside a Celery prefork child. Run database-backed maintenance/reconciliation
   through bounded Celery tasks rather than API timers.
4. Provide isolated document, source, research, maintenance and dispatch queues, shared API image/deployment
   configuration, readiness checks, and a multi-Pod rollout/rollback runbook. Keep long-running
   source workflows separate from the document workers whose publication they await.
5. Verify transport contracts, execution isolation, redelivery, scheduler disabling, configuration
   and image assembly. Run focused TypeScript/Python tests and type/lint checks. Do not perform a
   live deployment or switch existing environments without explicit operator authorization.

## Capacity and safety

- One delivered document message runs one compilation attempt; Celery concurrency determines
  concurrent engine processes. Per-engine parser/model/memory limits still apply, so total model
  pressure is worker replicas × Celery child concurrency × per-engine model concurrency.
- Use prefork, late acknowledgements and prefetch=1 for these queues. Do not mix source and document
  execution into a single-capacity worker, because source publication waits for document execution.
- Database reconciliation remains necessary even with a broker: publication failures and process
  crashes can happen between database commit, broker publish and acknowledgement.
- Embedded and Celery consumers must not be enabled together during the cutover. Stage updated
  images with the background flag disabled; pause admissions and drain embedded execution before
  switching API replicas, enabling the publisher/Beat flag and starting the dedicated consumers.

## Verification status

Iterations 1–4 are implemented, and the local checks in iteration 5 have passed:

- API application: 453 tests in 61 files, including actual private Node IPC child processes and
  compilation/outbox integration with an in-memory durable repository and mocked broker publisher.
- API library: 235 focused runtime/gateway tests; platform adapters: 118 tests.
- Python publisher, task, process lifecycle and configuration contracts: 38 tests in the final
  changed-file regression run.
- Compose/Kubernetes and image-assembly contracts: 18 tests; Compose configuration validation.
- TypeScript and Python type checks, Biome/Ruff, API response-contract lint, shell syntax and
  production JavaScript bundle build.

This is **not a deployment record**. No actual environment was switched. A complete Linux image
build, live broker/database integration and multi-Pod acceptance (forced worker termination,
recovery, backlog scaling and representative imports) remain deployment gates. Follow
[the controlled rollout runbook](celery-worker-runbook.md); local tests do not replace those checks.
