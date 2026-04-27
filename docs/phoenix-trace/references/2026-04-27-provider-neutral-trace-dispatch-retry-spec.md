# Provider-Neutral Trace Dispatch Retry Spec

Date: 2026-04-27
Status: Spec
Source: SOLID review of `api/tasks/ops_trace_task.py`

## Summary

`api/tasks/ops_trace_task.py` no longer imports Phoenix provider code, but the generic trace dispatch task still encodes Phoenix-specific retry semantics in names, logs, and the caught exception type. This is acceptable as a transitional fix, but it leaves the generic task closed over one provider's current failure mode.

This spec tightens the boundary by making retryable trace dispatch a provider-neutral core contract. Phoenix remains the only current producer of the pending-parent condition, while the task handles any retryable trace dispatch failure through the same abstraction.

## Goals

1. Keep Phoenix nested workflow pending-parent retry behavior unchanged.
2. Make `tasks.ops_trace_task` depend on a provider-neutral core exception contract.
3. Remove Phoenix-specific names and log messages from the generic task.
4. Keep Phoenix-specific Redis parent span coordination inside the Phoenix provider.
5. Preserve enterprise trace retry idempotency and payload cleanup semantics.

## Non-Goals

- Do not introduce a shared Redis parent span context store.
- Do not redesign the trace provider interface.
- Do not change Phoenix span hierarchy, session semantics, or span naming.
- Do not change the trace payload schema except existing private retry-local metadata such as `_enterprise_trace_dispatched`.
- Do not make all provider failures retryable; only explicit core retryable exceptions should be retried.

## Requirements

### 1. Generic Retryable Dispatch Contract

The generic task must catch a provider-neutral base exception:

- `RetryableTraceDispatchError` remains the core base class for transient trace dispatch failures.
- `PendingTraceParentContextError` remains a specific subclass for the current nested trace parent-context condition.
- `process_trace_tasks` catches `RetryableTraceDispatchError`, not `PendingTraceParentContextError`.
- Provider-specific details may appear in the exception message, not in the task's control-flow names.

### 2. Provider-Neutral Task Naming

The task must not use Phoenix-specific identifiers for generic retry policy:

- `_PENDING_PHOENIX_PARENT_RETRY_LIMIT` should become `_RETRYABLE_TRACE_DISPATCH_LIMIT`.
- `_PENDING_PHOENIX_PARENT_RETRY_DELAY_SECONDS` should become `_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS`.
- logs should refer to "retryable trace dispatch failure" or equivalent provider-neutral language.

### 3. Phoenix Provider Boundary

Phoenix remains responsible for Phoenix-only mechanics:

- Redis key shape: `trace:phoenix:parent_span:{parent_node_execution_id}`.
- TTL for the parent span carrier.
- carrier JSON validation.
- OpenTelemetry traceparent validation and context restoration.
- raising `PendingTraceParentContextError` when the parent carrier is not yet available.

### 4. Retry and Cleanup Semantics

The cleanup behavior must remain unchanged:

- successful trace dispatch deletes the stored payload.
- terminal trace dispatch failure increments the failed counter and deletes the payload.
- successful Celery retry scheduling preserves the stored payload.
- retry scheduling failure increments the failed counter and deletes the payload.
- `_enterprise_trace_dispatched` remains persisted before retry when enterprise telemetry has already run.

## Acceptance Criteria

- `api/tasks/ops_trace_task.py` imports and catches `RetryableTraceDispatchError`.
- `api/tasks/ops_trace_task.py` has no Phoenix-specific retry policy constant names.
- generic task logs use provider-neutral retry language.
- Phoenix tests still assert `PendingTraceParentContextError` for a missing parent span carrier.
- task tests cover retry behavior through the base `RetryableTraceDispatchError`.
- existing enterprise trace idempotency tests continue to pass.
- no production code imports Phoenix provider exceptions from the generic task layer.

## Risks

The main risk is accidentally broadening retry behavior. Catching the base class is safe only if the base class remains reserved for explicitly retryable provider signals. The implementation must not catch arbitrary provider exceptions, `RuntimeError`, or `Exception` in the retry path.

The second risk is losing diagnostic value in logs. Provider-neutral task logs should still include the exception message so Phoenix-specific parent-node context remains observable without encoding Phoenix into the generic task.
