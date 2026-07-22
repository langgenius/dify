# Retrieval and durable-task operational metrics

Date: 2026-07-21

## What changed

- Added aggregation-only retrieval result metrics for Fast, Deep, Research, and Auto requests:
  requested/resolved mode, candidate count, filtered count, result count, rerank latency, and the
  zero-result signal.
- Preserved the original Auto request mode through the query and durable Research boundaries while
  continuing to execute only the already resolved Fast/Deep/Research mode.
- Added durable task lifecycle metrics for Research and document compilation at committed
  transitions: queued, running, retry, and terminal (completed, failed, or canceled).
- Wired both metric families into the API app's structured operational metric sink.
- Metric delivery is best-effort for both synchronous throws and rejected promises. Events contain
  no tenant, knowledge-space, task/request identifier, token, URL, model identifier, or free-form
  error text.

## Why

The production integration plan needs low-cardinality signals for retrieval effectiveness and
durable execution health without coupling product correctness to telemetry availability or exposing
customer scope and payload data in logs.

## Verification

- TDD RED was observed for the missing metric module, sink properties, and lifecycle callbacks.
- `@knowledge/api`: 64 focused tests passed across metric reduction, Auto propagation, Research and
  compilation state machines, and both durable runtimes.
- `@knowledge/api-app`: 34 focused tests passed across the structured sink, outer retrieval boundary,
  and production Research/compilation assembly.
- `@knowledge/api` and `@knowledge/api-app` TypeScript checks passed.
- Biome passed for all 26 touched TypeScript files; the final metric helper recheck also passed.
- Focused `git diff --check` passed.

Repository-wide coverage, `pnpm check`, and the full workspace gate were intentionally not run in
this subtask because the parent iteration owns the final frozen-tree coverage/check execution.
