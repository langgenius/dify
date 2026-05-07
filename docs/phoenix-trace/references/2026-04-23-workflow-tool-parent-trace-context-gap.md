# Workflow Tool Parent Trace Context Gap

Date: 2026-04-23
Status: Analysis note

## Summary

In the "top-level workflow triggers nested workflows published as tools" scenario, `WorkflowTraceInfo.resolved_parent_context` is `None` not because Phoenix fails to parse it, but because upstream `api/` never produces `parent_trace_context` for the nested workflow run trace.

This means the current Phoenix-local fallback logic:

- `conversation_id`
- `parent_trace_context.parent_workflow_run_id`
- `workflow_run_id`

cannot unify nested workflow sessions in real traffic for this scenario, because `parent_workflow_run_id` never reaches Phoenix.

## What Phoenix Expects

`BaseTraceInfo.resolved_parent_context` only reads:

- `metadata["parent_trace_context"]["parent_workflow_run_id"]`
- `metadata["parent_trace_context"]["parent_node_execution_id"]`

Reference:

- `api/core/ops/entities/trace_entity.py`

`TraceTask.workflow_trace()` only copies `parent_trace_context` into workflow trace metadata if it already exists in `self.kwargs`.

Reference:

- `api/core/ops/ops_trace_manager.py`

So the Phoenix side is purely a consumer here.

## Where The Context Is Lost

For workflow-as-tool invocation, the parent context is not produced or forwarded along the workflow tool execution path.

### 1. Tool runtime invocation does not include parent trace context

The workflow tool runtime path invokes the tool with fields such as:

- `user_id`
- `conversation_id`
- `app_id`
- `workflow_call_depth`

but not:

- `parent_trace_context`
- outer `workflow_run_id`
- outer `node_execution_id`

Reference:

- `api/core/workflow/node_runtime.py`
- `api/core/tools/tool_engine.py`

### 2. WorkflowTool starts a nested workflow without parent trace context

`WorkflowTool._invoke()` calls `WorkflowAppGenerator.generate(...)` with:

- `args={"inputs": ..., "files": ...}`
- `invoke_from`
- `streaming`
- `call_depth`

but does not pass any parent trace metadata.

Reference:

- `api/core/tools/workflow_as_tool/tool.py`

### 3. WorkflowAppGenerator only carries external trace id

`WorkflowAppGenerator.generate()` creates a new `TraceQueueManager` and only extracts `external_trace_id` from `args` into `extras`.

It does not extract or store `parent_trace_context`.

Reference:

- `api/core/app/apps/workflow/app_generator.py`
- `api/core/helper/trace_id_helper.py`

### 4. Workflow trace task enqueue does not include parent trace context

When the workflow trace task is created, the persistence layer passes:

- `workflow_execution`
- `conversation_id`
- `user_id`
- `external_trace_id`

and still does not include `parent_trace_context`.

Reference:

- `api/core/app/workflow/layers/persistence.py`

## Why The Result Is `None`

Because `parent_trace_context` is never supplied on the workflow-as-tool path:

- `TraceTask.workflow_trace()` sees no `self.kwargs["parent_trace_context"]`
- `WorkflowTraceInfo.metadata` has no `parent_trace_context`
- `resolved_parent_context` returns `(None, None)`

This matches the observed Phoenix log:

- `parent_workflow_run_id=None`
- `parent_node_execution_id=None`

## What This Is Not

This does not appear to be:

- a Phoenix parsing bug
- a different key/shape being used elsewhere
- a loss during `WorkflowTraceInfo` serialization

The issue is earlier: the published-workflow-as-tool path does not produce the expected parent context at all.

## Practical Consequence

For this specific scenario, Phoenix-only fixes are insufficient for session inheritance or cross-workflow parent linking if they depend on `resolved_parent_context`.

To make nested workflow traces inherit parent workflow session and parent span correctly, upstream code must first propagate:

- `parent_workflow_run_id`
- `parent_node_execution_id`

through the workflow-as-tool invocation path.

## Likely Upstream Touch Points

If this is fixed later, the most relevant upstream path to inspect is:

- `api/core/tools/workflow_as_tool/tool.py`
- `api/core/app/apps/workflow/app_generator.py`
- `api/core/app/workflow/layers/persistence.py`
- `api/core/ops/ops_trace_manager.py`

The main design point is not how Phoenix reads the field, but where the workflow tool invocation should create and forward the field.
