# 0006. Two-Phase Upstream Parent Context Strategy

Date: 2026-04-23
Status: Accepted

## Context

The Phoenix-side session unification fallback is already implemented, and the downstream carrier chain now works:

- `workflow_as_tool/tool.py` can produce `parent_trace_context`
- `app_generator.py` can carry it through `extras`
- `persistence.py` can enqueue it into `TraceTask`
- Phoenix can consume `resolved_parent_context`

However, real workflow-as-tool runs still produce:

- `parent_workflow_run_id=None`
- `parent_node_execution_id=None`

The reason is earlier in the chain: `WorkflowTool._invoke()` expects these values to already exist in `self.runtime.runtime_parameters`, but production runtime construction does not populate them.

Investigation showed an important asymmetry:

- `outer_workflow_run_id` is likely available from workflow system variables / variable pool
- `outer_node_execution_id` is not currently exposed on the workflow-tool runtime boundary

This means session unification and parent-span linking have different difficulty levels and should not be forced into one patch.

## Decision

Adopt a two-phase upstream strategy.

### Phase 1

Patch the workflow-tool runtime construction boundary to inject `outer_workflow_run_id` into workflow tool runtime parameters.

Goal:

- unblock nested workflow session unification for top-level workflow debugging and similar workflow-as-tool scenarios

Expected result:

- parent workflow run identity becomes available to the existing upstream carrier chain
- Phoenix session inheritance can finally resolve nested workflows into the same session as the outer workflow

### Phase 2

Design and implement a separate boundary extension for `outer_node_execution_id`.

Goal:

- enable stable parent-span linking from nested workflow traces to the outer tool node span

This phase likely requires a runtime/protocol change rather than another local fallback.

## Rationale

This split follows the "done is better than perfect" principle while preserving correctness:

- session unification has immediate user-visible value
- `outer_workflow_run_id` appears obtainable without larger architectural changes
- `outer_node_execution_id` is a structural gap and should be solved deliberately
- forcing both into a single patch would either block useful progress or reintroduce heuristic-heavy behavior

## Consequences

In the near term:

- we can target session correctness first
- nested workflow traces may still lack precise parent-span attachment until Phase 2 lands

In the medium term:

- Phase 2 should extend the runtime boundary so workflow-as-tool invocation can propagate the current tool node execution identity without relying on database or timing heuristics

## Implementation Notes

The preferred Phase 1 patch point is the workflow-tool runtime construction layer:

- `api/core/workflow/node_runtime.py`

Likely supporting points:

- `api/core/tools/tool_manager.py`

The existing downstream carrier chain should be reused unchanged once `outer_workflow_run_id` becomes available.
