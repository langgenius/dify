# Phoenix Parent Tool-Span Resolution Plan

Date: 2026-04-23
Status: Draft
Scope: Dify Phoenix provider and trace task retry path

## Goal

Make nested workflow spans attach to the triggering outer tool span in Phoenix, not just to the
shared trace/session.

## Success Criteria

- Phoenix publishes tool-node span context keyed by `node_execution_id`
- nested workflow trace emission consumes `parent_node_execution_id`
- nested workflow spans start under the correct outer tool span when the parent context is available
- when the child trace task arrives too early, the task retries in a bounded way instead of immediately
  falling back to the synthetic root
- targeted Phoenix and task tests cover the happy path and retry path

## Task 1: Parent Span Context Bridge

Implement a Phoenix-local helper for publishing and resolving parent span context.

Expected outcomes:

- tool node spans can publish a restorable parent-span context to Redis
- nested workflow emission can resolve a stored parent-span context by `parent_node_execution_id`
- a dedicated pending-parent exception is available for retry orchestration

Files likely involved:

- `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- possibly a small helper module under the same package
- targeted Phoenix unit tests

## Task 2: Retry-Aware Trace Task Handling

Add bounded retry behavior for the Phoenix pending-parent case.

Expected outcomes:

- `process_trace_tasks` becomes retry-capable for this one class of transient ordering problem
- trace payload files are preserved while a retry is scheduled
- terminal fallback still cleans up correctly and records failure or fallback clearly

Files likely involved:

- `api/tasks/ops_trace_task.py`
- targeted task tests if present, otherwise focused regression coverage around the new branch

## Verification

Run focused tests for:

- Phoenix trace unit tests
- workflow-tool runtime and workflow-as-tool tests that already protect parent context propagation
- ops trace task behavior for retry and cleanup

Manual verification target:

- one top-level workflow
- multiple nested workflows published as tools inside a loop

Expected Phoenix result:

- one session
- one trace tree
- nested workflow spans parented to their corresponding tool spans instead of the synthetic `Dify` root

## Delivery Notes

- keep this Phoenix-local and transitional
- avoid touching unrelated upstream semantics
- keep Redis coordination data short-lived via TTL
- prefer tight, targeted tests over broad suite expansion
