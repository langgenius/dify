# Cross-Repo Workflow-Tool Parent Context Implementation Plan

Date: 2026-04-23
Status: Draft
Scope: Graphon + Dify coordinated implementation

## Goal

Enable nested workflows published as tools to propagate parent workflow and parent tool-node execution context all the way into Phoenix tracing.

## Success Criteria

For a top-level workflow invoking nested workflows as tools:

- the outer workflow run id is available to workflow-tool invocation
- the outer tool node execution id is available to workflow-tool invocation
- Dify builds `parent_trace_context` from those values
- Phoenix resolves both inherited session and parent span context

## Task 1: Graphon Runtime Contract

Update Graphon tool runtime APIs so tool-node execution context is available to workflow adapters.

Expected outcomes:

- the runtime boundary no longer drops `variable_pool` for older tool-node versions
- the current tool node execution id is available at runtime creation or invocation time

Files likely involved:

- `src/graphon/nodes/runtime.py`
- `src/graphon/nodes/tool/tool_node.py`
- targeted Graphon node/runtime tests

## Task 2: Dify Workflow Adapter Integration

Update Dify workflow tool runtime integration to consume the Graphon contract.

Expected outcomes:

- workflow-tool runtime parameters include `outer_workflow_run_id`
- workflow-tool runtime parameters include `outer_node_execution_id`
- workflow tools continue to avoid affecting non-workflow tool types

Files likely involved:

- `api/core/workflow/node_runtime.py`
- `api/tests/unit_tests/core/workflow/test_node_runtime.py`

## Task 3: Parent Trace Context Construction

Update workflow-as-tool tracing input construction to use the now-complete upstream runtime parameters.

Expected outcomes:

- `WorkflowTool._invoke()` emits `parent_trace_context`
- the existing app generator and persistence carrier path continues unchanged or with minimal adaptation

Files likely involved:

- `api/core/tools/workflow_as_tool/tool.py`
- related tests under `api/tests/unit_tests/core/tools/workflow_as_tool/`
- possibly helper tests if the payload validation rules change

## Task 4: Phoenix Integration Verification

Verify the resulting trace path end to end.

Expected outcomes:

- Phoenix logs show non-null `parent_workflow_run_id`
- Phoenix logs show non-null `parent_node_execution_id`
- nested workflow session inheritance works
- nested workflow parent span resolution is available for further hierarchy validation

Files likely involved:

- `api/providers/trace/trace-arize-phoenix/...`
- existing targeted Phoenix tests

## Verification

### Graphon

Run the smallest relevant Graphon test targets covering:

- tool-node runtime boundary
- tool-node execution context

### Dify

Run focused Dify tests for:

- workflow node runtime
- workflow-as-tool
- app generator
- persistence layer
- Phoenix targeted unit tests

### Manual

Use the real debugger scenario:

- one top-level workflow
- multiple nested workflows published as tools

Expected log shape:

- `parent_workflow_run_id=<outer run id>`
- `parent_node_execution_id=<outer tool node execution id>`

## Delivery Notes

- Keep `api/pyproject.toml` editable Graphon override local-only
- Commit Graphon changes only from the clean Graphon worktree
- Commit Dify changes separately in the Dify repo
