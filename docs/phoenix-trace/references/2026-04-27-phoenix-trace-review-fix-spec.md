# Phoenix Trace Review Fix Spec

Date: 2026-04-27
Status: Spec
Review source: `docs/phoenix-trace/references/2026-04-27-phoenix-trace-feature-code-review.md`

## Summary

This spec covers the follow-up changes for the Phoenix tracing review findings. The goal is to keep the Phoenix nested workflow feature behavior, while moving internal trace metadata and retry contracts back behind internal boundaries.

The implementation should fix three concrete risks and document one intentional transitional boundary:

- workflow tool parent trace context must not overwrite user workflow inputs
- generic trace dispatch must not import a Phoenix provider exception
- Phoenix pending-parent retries must not re-emit enterprise traces
- Phoenix-local Redis parent span coordination may remain provider-local for now, but the code must say why and where it should move if reused

## Goals

1. Preserve nested workflow parent trace propagation for Phoenix.
2. Prevent internal trace IDs from being merged into public workflow tool input parameters.
3. Keep `tasks.ops_trace_task` dependent only on core retry contracts, not provider implementation symbols.
4. Avoid duplicate enterprise trace emission when Phoenix requests a bounded retry for pending parent span context.
5. Add a short code comment around Phoenix Redis parent span coordination to make the provider-local boundary intentional.

## Non-Goals

- Do not redesign the entire trace provider interface.
- Do not extract a shared Redis parent span context store in this pass.
- Do not change Phoenix span hierarchy or naming semantics.
- Do not change the serialized `parent_trace_context` metadata shape already consumed by enterprise telemetry and Phoenix.

## Requirements

### 1. Private Workflow Tool Parent Context

The outer workflow run id and outer tool node execution id must be carried through a private runtime channel, not through `ToolRuntime.runtime_parameters`.

Required behavior:

- Workflow tool execution still forwards:
  - `parent_workflow_run_id`
  - `parent_node_execution_id`
- User tool input keys named `outer_workflow_run_id` or `outer_node_execution_id` remain user-controlled inputs.
- Non-workflow tool providers receive no parent trace context.

Preferred design:

- Extend the workflow-private `_WorkflowToolRuntimeBinding` in `api/core/workflow/node_runtime.py`.
- Store `parent_trace_context` on the binding.
- Pass that context from `DifyToolNodeRuntime.invoke()` to workflow tool invocation through a private parameter.
- Keep `Tool.invoke()` and generic tool invocation behavior unchanged for non-workflow tools.

### 2. Core Retry Contract

The pending-parent retry signal must be defined in core code.

Required behavior:

- `api/tasks/ops_trace_task.py` catches a core exception type.
- Phoenix raises the core exception type when the Redis parent span carrier is not available yet.
- Tests no longer import the retry exception from the Phoenix provider.

Preferred design:

- Add `api/core/ops/exceptions.py`.
- Define `class RetryableTraceDispatchError(RuntimeError)`.
- Define `class PendingTraceParentContextError(RetryableTraceDispatchError)`.
- Keep `parent_node_execution_id` available on the pending-parent exception.

### 3. Enterprise Trace Retry Idempotence Boundary

Phoenix pending-parent retry must not cause enterprise trace emission to run again.

Required behavior:

- A task attempt may emit enterprise telemetry once.
- If provider dispatch asks for retry after enterprise emission succeeded, the retry payload keeps enough state to skip enterprise emission on the next attempt.
- If enterprise telemetry raises internally and is logged, provider dispatch still runs as today.
- Terminal task failures still delete the payload file.
- Scheduled Celery retries still preserve the payload file.

Preferred design:

- Store a private flag in the trace payload file, for example `_enterprise_trace_dispatched`.
- Set the flag after enterprise trace dispatch block completes.
- Persist the payload before scheduling retry.
- On retry attempts, skip enterprise dispatch if the flag is already true.

### 4. Phoenix-Local Parent Span Coordination Comment

The Phoenix provider may keep Redis keying, TTL, carrier validation, and pending-parent signaling in the provider for this phase.

Required behavior:

- Add a concise comment near the Phoenix Redis parent span helper functions.
- The comment must state that this is intentionally provider-local for the current Phoenix-only feature.
- The comment must state that if other providers need the same nested workflow parent restoration behavior, the storage and retry signaling should move to a core abstraction.

## Acceptance Criteria

- A workflow-as-tool input named `outer_workflow_run_id` is delivered to the nested workflow as user input, not overwritten by internal trace metadata.
- Nested workflow `parent_trace_context` is still generated when both outer workflow run id and outer node execution id are available.
- `tasks.ops_trace_task` imports retry exceptions only from `core.ops`.
- Phoenix provider imports and raises the core pending-parent exception.
- Unit tests cover retry payload preservation and enterprise dispatch skip on retry.
- Existing Phoenix pending-parent retry tests still pass after updating imports.
- The Phoenix provider contains an explicit provider-local coordination comment.

## Risk Notes

The highest-risk change is replacing the `runtime_parameters` side channel because workflow tool invocation currently relies on the base `Tool.invoke()` signature. The safest implementation should avoid changing the public base tool contract for all tools unless necessary. Prefer a narrow private adapter inside `DifyToolNodeRuntime.invoke()` and `WorkflowTool`.

The second highest-risk change is persisting retry state in the trace payload file. The implementation must preserve existing cleanup behavior: delete on success and terminal failure, preserve only when Celery retry is actually scheduled.
