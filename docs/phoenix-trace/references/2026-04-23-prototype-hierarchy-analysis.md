# Prototype Hierarchy Analysis

Date: 2026-04-23
Context: Re-implement the hierarchy improvements from `/Users/yang/Downloads/arize_phoenix_trace.py` on top of current `origin/main`.

## Goal

Understand how the prototype makes Dify tracing show a better hierarchy, especially:

- nested sub-workflows under the parent tool span
- workflow-internal node-to-node hierarchy instead of a flat list under the workflow root

## High-Level Conclusion

The prototype improves hierarchy by rebuilding explicit OTEL parent-child relationships, not just by attaching more metadata or nicer span names.

It does this in two layers:

1. Cross-workflow hierarchy
   Child workflow spans are attached under the parent workflow's tool span and reuse the parent trace ID.
2. In-workflow hierarchy
   Node spans are assigned parents using workflow graph edges first, then execution-order heuristics as fallback.

## Layer 1: Cross-Workflow Hierarchy

### Core behavior

In `workflow_trace()`, the prototype first checks whether the current workflow run is actually a child workflow invoked by another workflow.

If yes:

- it reuses the parent trace ID instead of opening a new trace
- it uses the parent tool span ID as the parent context
- it starts the child workflow span under that tool span

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:207`
- `/Users/yang/Downloads/arize_phoenix_trace.py:210`
- `/Users/yang/Downloads/arize_phoenix_trace.py:269`
- `/Users/yang/Downloads/arize_phoenix_trace.py:288`

### How parent workflow context is resolved

The prototype tries two strategies:

1. Read explicit metadata fields
   - `parent_trace_id`
   - `parent_span_id`
2. If missing, infer parent by querying the database
   - detect that the child app is registered as a workflow tool
   - search for matching parent tool executions in a time window around child workflow start

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:1226`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1255`

### How child workflows are associated with tool nodes

When processing tool nodes, the prototype tries to determine whether a tool triggered a child workflow.

It checks in order:

1. Direct workflow identifiers in `outputs`
2. Workflow execution hints in `process_data`
3. Timing-based correlation against recently started `WorkflowRun` records

It also tries to avoid assigning the same child workflow to multiple tools in the same parent workflow.

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:1664`

### Why this improves hierarchy

Because OTEL parent context is explicitly set, Phoenix can display:

- outer workflow root
- tool span
- nested child workflow root
- child workflow's own nodes

instead of rendering the child workflow as a separate unrelated trace or as a flat sibling.

## Layer 2: In-Workflow Node Hierarchy

### Core behavior

Inside one workflow, the prototype does not simply attach every node span directly under the workflow span.

Instead it tries to reconstruct a more meaningful node hierarchy.

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:298`
- `/Users/yang/Downloads/arize_phoenix_trace.py:456`

### Hierarchy sources

The prototype combines multiple signals:

1. Workflow graph edges
   It builds a `target -> source` map from the saved graph.
2. Decision-path adjustments
   It refines parentage for branching nodes such as classifier / if-else.
3. Loop adjustments
   It refines parentage for loop executions.
4. Execution-order fallback
   If a graph parent is not available yet, it picks the most recent already-created span with a lower execution index.

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:1182`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1211`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1215`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1819`

### Parent selection rules seen in the prototype

For each node span:

- `start` nodes are direct children of the workflow span
- `end` nodes try to attach to the last executed non-end node
- if a graph parent has already been processed, use that parent span
- for execution-heavy nodes like `tool`, `llm`, and `http-request`, fall back to the most recent earlier span
- otherwise attach directly to the workflow span

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:460`
- `/Users/yang/Downloads/arize_phoenix_trace.py:480`
- `/Users/yang/Downloads/arize_phoenix_trace.py:487`

### Why this improves hierarchy

This makes the trace tree look closer to execution flow rather than a flat bag of node spans. It is especially helpful for:

- branch nodes
- loops
- chained tool or LLM activity
- end nodes that conceptually close a sub-path

## Important Detail: Stable Deterministic IDs

The prototype uses deterministic hash-derived identifiers:

- trace IDs from `trace_id` or `workflow_run_id`
- workflow span IDs from `workflow_run_id`
- node span IDs from `workflow_run_id + node_execution_id`

Relevant prototype locations:

- `/Users/yang/Downloads/arize_phoenix_trace.py:95`
- `/Users/yang/Downloads/arize_phoenix_trace.py:111`
- `/Users/yang/Downloads/arize_phoenix_trace.py:222`
- `/Users/yang/Downloads/arize_phoenix_trace.py:227`
- `/Users/yang/Downloads/arize_phoenix_trace.py:438`

This matters because hierarchy reconstruction depends on stable identity across separately emitted spans.

## Mapping to Current `origin/main`

Current `origin/main` already contains the key building block for cross-workflow hierarchy.

### Existing pieces already present

`BaseTraceInfo.resolved_parent_context` extracts typed parent workflow context from `metadata["parent_trace_context"]`.

Relevant current code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:50`

`EnterpriseOtelTrace._workflow_trace()` passes:

- `trace_correlation_override`
- `parent_span_id_source`

to the exporter when parent workflow context exists.

Relevant current code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/enterprise_trace.py:184`

`export_span()` already supports:

- reusing an outer trace correlation
- constructing a non-recording parent span context from an explicit parent span source

Relevant current code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/exporter.py:184`
- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/exporter.py:209`

The current README also explicitly documents the intended nested-sub-workflow shape.

Relevant current docs:

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/README.md:66`

### What seems missing compared with the prototype

Compared with the prototype, current `origin/main` appears to already support:

- child workflow under parent tool span

But it likely does not yet reproduce the second layer from the prototype:

- node-to-node hierarchy within a workflow using graph relationships and execution-order fallback

Current exporter behavior appears closer to:

- workflow root span as parent of all node spans in the same workflow

unless another explicit parent is provided.

## Practical Takeaway for Re-Implementation

If we want both layers from the prototype on top of `origin/main`, we should likely treat them separately:

1. Verify and preserve existing cross-workflow parent propagation
   - parent workflow run ID
   - parent node execution ID
   - shared trace ID across nested workflows
2. Add in-workflow node hierarchy reconstruction
   - probably in the workflow node tracing path
   - based on graph structure plus execution fallbacks

## Current Working Hypothesis

The prototype's real innovation is not the naming scheme.

The real innovation is:

- cross-workflow span parenting through shared trace ID plus explicit parent tool span
- in-workflow node parenting through reconstructed graph/execution relationships

This is the behavior we should preserve when re-implementing on `origin/main`.
