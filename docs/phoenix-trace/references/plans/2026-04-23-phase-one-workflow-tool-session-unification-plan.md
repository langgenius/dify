# Phase 1 Workflow-Tool Session Unification Plan

Date: 2026-04-23
Status: Draft
Scope: upstream phase-one patch only

## Goal

Make workflow-as-tool executions expose enough upstream context for nested workflow traces to inherit the outer workflow session.

This phase only targets session unification.

It does not attempt to solve precise parent-span linking for nested workflows.

## Why This Plan Exists

Current production runs prove that the downstream carrier chain works only if `parent_trace_context` exists.

The missing input is not in Phoenix. It is the absence of upstream runtime parameters that can seed `parent_trace_context`.

Among the two missing values:

- `outer_workflow_run_id` appears obtainable now
- `outer_node_execution_id` does not

So Phase 1 should limit itself to the part we can source safely.

## Target Files

- `api/core/workflow/node_runtime.py`
- `api/core/tools/tool_manager.py` if needed
- tests around workflow tool runtime construction and workflow-as-tool invocation

## Proposed Change

### 1. Runtime Injection

Update workflow-tool runtime construction so the runtime parameters for workflow-as-tool invocations include:

- `outer_workflow_run_id`

The value should be derived from workflow system variables / variable pool rather than inferred later.

### 2. Preserve Existing Downstream Chain

Do not redesign the later carrier path in this phase.

Reuse the existing flow:

- workflow tool builds `parent_trace_context`
- app generator carries it in `extras`
- persistence enqueues it into `TraceTask`
- Phoenix resolves inherited session from `parent_workflow_run_id`

### 3. Do Not Fake Node Execution Identity

Do not add a heuristic or placeholder for `outer_node_execution_id` in this phase.

If the value is unavailable at the runtime boundary, leave it absent and treat that as Phase 2 work.

## Testing Strategy

### Unit Tests

- add or update runtime construction tests to verify workflow-tool runtime parameters include `outer_workflow_run_id`
- keep workflow-as-tool tests asserting `parent_trace_context` is produced when runtime parameters are complete enough for Phase 1

### Regression Tests

- rerun the existing upstream chain tests
- rerun targeted Phoenix workflow session tests

### Manual Verification

Use the real scenario:

- one top-level workflow
- multiple nested workflows published as tools

Expected result after Phase 1:

- Phoenix logs show `parent_workflow_run_id=<outer workflow run id>`
- nested workflows resolve the same `session.id` as the outer workflow

Still acceptable after Phase 1:

- `parent_node_execution_id` may remain `None`
- parent-span attachment may remain incomplete

## Out Of Scope

- exposing current tool node execution id through runtime/protocol boundaries
- changing Phoenix parent-span wiring rules
- any database or timing heuristic fallback for parent node execution lookup

## Follow-Up

After Phase 1 lands and is verified, prepare a separate plan for Phase 2:

- how to surface `outer_node_execution_id`
- whether that requires a graphon/runtime protocol change
- how to test parent-span attachment end-to-end
