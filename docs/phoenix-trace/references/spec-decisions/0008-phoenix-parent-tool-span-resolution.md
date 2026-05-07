# 0008. Phoenix Parent Tool-Span Resolution For Nested Workflows

Date: 2026-04-23
Status: Accepted

## Context

The cross-repo parent-context work is now sufficient to put nested workflows into:

- the same trace as the outer workflow
- the same session as the outer workflow

Real Phoenix trace output shows that nested workflow spans still attach to the synthetic
`Dify` root span instead of the triggering outer tool span.

Current Phoenix behavior explains this:

- `parent_workflow_run_id` is used to reuse the outer trace root
- `parent_node_execution_id` is parsed and logged
- but `parent_node_execution_id` is not yet used to reconstruct the actual parent span context

Because Phoenix spans are emitted asynchronously from trace tasks, the nested workflow task
does not have an in-memory reference to the outer tool span object. Parenting therefore needs
an explicit Phoenix-local bridge.

## Decision

Implement a Phoenix-local parent-span bridge using persisted span context plus task retry.

### Parent span publication

When Phoenix emits a workflow node span for a tool node, it should publish the resulting span
context in Redis, keyed by the node execution id.

The stored payload should be the minimum data required to reconstruct an OpenTelemetry parent
context for later child workflow spans.

### Parent span consumption

When Phoenix emits a nested workflow span and `parent_node_execution_id` is present, it should:

1. look up the previously published parent span context in Redis
2. if found, extract that context and start the nested workflow span under it
3. if not found yet, signal a retryable pending-parent condition instead of silently attaching
   the child workflow to the synthetic root on the first attempt

### Retry strategy

`ops_trace_task` should support bounded retry for this specific pending-parent condition.

This retry flow must preserve the trace payload file until the retry path is finished.

If the parent span context is still unavailable after the bounded retry budget is exhausted,
Phoenix may fall back to the current root-parenting behavior, but only after logging that the
correct tool-parent relationship could not be restored in time.

## Rationale

This approach matches the current ownership boundary:

- upstream and Graphon already propagate `parent_node_execution_id`
- Phoenix owns the provider-local span emission order problem
- Redis is already available and is suitable for short-lived cross-task coordination

It also avoids trying to retrofit deterministic span ids into the OpenTelemetry SDK path.

## Consequences

This change is expected to touch:

- Phoenix provider span emission helpers
- a small Redis-backed parent-span context helper
- `ops_trace_task` retry behavior for the Phoenix pending-parent case
- targeted Phoenix and task-level tests

This remains a transitional Phoenix-local solution. If future upstream tracing exposes stable
provider-agnostic parent-span contracts, this bridge should become removable.
