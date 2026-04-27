# 0005. Nested Workflow Session Inheritance In Phoenix

Date: 2026-04-23
Status: Accepted for v1

## Context

Phoenix session grouping is currently aligned with the existing Phoenix-local helper:

- if `conversation_id` exists, use `conversation_id`
- otherwise use the current workflow's `workflow_run_id`

That behavior keeps top-level chatflow and top-level workflow semantics simple, but it causes nested workflows triggered from a top-level workflow to split into separate Phoenix sessions when the child workflows do not carry a `conversation_id`.

At the same time, cross-workflow trace correlation already reuses upstream `parent_trace_context.parent_workflow_run_id`, so the trace tree is shared even while the Phoenix session is split.

## Decision

### Session Resolution Rule

For workflow tracing in Phoenix v1, the local fallback order should be:

1. `conversation_id`
2. `parent_trace_context.parent_workflow_run_id`
3. current `workflow_run_id`

This means:

- top-level chatflow continues to group by `conversation_id`
- top-level workflow continues to group by its own `workflow_run_id`
- nested workflow without `conversation_id` inherits the parent workflow session by using the outer `workflow_run_id`

### Scope

This decision applies only to Phoenix-local session grouping behavior.

It does not change upstream trace contracts or upstream session semantics.

### Non-Goal

This decision does not solve Phoenix session summary fields such as session-level first input or last output when Phoenix displays a synthetic root span above the workflow span.

That is a separate display/root-shaping problem and should not block session unification for nested workflows.

## Rationale

For the workflow-only case already agreed in the earlier notes:

- top-level workflow session identity is `workflow_run_id`
- nested workflows should inherit the outer workflow session

The existing upstream parent context already carries the parent workflow run identifier, so Phoenix can apply this inheritance rule locally without waiting for an explicit upstream `parent_session_id`.

## Notes For Future Migration

This is still a transitional Phoenix-local rule.

If upstream tracing later exposes an explicit `parent_session_id` or a fully standardized session contract, Phoenix should stop inferring nested workflow session inheritance from `parent_workflow_run_id` and should consume the upstream session field directly.
