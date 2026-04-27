# Prototype Session And Root Span Analysis

Date: 2026-04-23
Context: Investigate why the prototype shows `session.id` on top-level spans, but Phoenix session pages still show `rootSpan: null` and render no visible session data.

## Observed Behavior

From the prototype test results:

- top-level workflow-like spans contain a non-empty `session.id`
- child spans inside the same trace often contain `session.id: ""`
- Phoenix session query returns valid sessions and `numTraces`
- each trace inside the session has `rootSpan: null`
- the Phoenix session page therefore shows no usable trace tree

An additional Phoenix trace-detail response shows:

- the trace has `rootSpans.edges`
- Phoenix treats the workflow-like span as a root-like span in the trace detail page
- but that span still has a non-empty `parentId`
- the referenced parent does not appear in the returned span list for that trace

## Main Conclusion

There are likely two separate problems, and they reinforce each other:

1. `session.id` propagation is inconsistent
2. The prototype likely creates orphan-root workflow spans rather than true canonical roots, so Phoenix cannot resolve `rootSpan` in session views

The second problem is the more critical one.

## Problem 1: Inconsistent `session.id` Propagation

The prototype sets `SpanAttributes.SESSION_ID` in some places, but not consistently across all spans.

### Workflow root span

The workflow span uses:

- `trace_info.conversation_id or trace_info.workflow_id or ""`

Relevant code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:261`

This means the workflow root span still gets a non-empty session ID in debugging mode, because `workflow_id` is used as a fallback.

### Workflow child node spans

Workflow node spans use:

- `trace_info.conversation_id or ""`

Relevant code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:608`

This means that in debugging mode, where `conversation_id` is often absent, child spans get an empty session ID.

### Message and other trace types

Some other trace types also set `SESSION_ID`, for example message and generate-name traces:

- `/Users/yang/Downloads/arize_phoenix_trace.py:721`
- `/Users/yang/Downloads/arize_phoenix_trace.py:765`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1059`

But not every trace path uses it, and not every child span inherits the same session value.

### Consequence

Phoenix session grouping may still find session-associated top-level spans, but child spans are not consistently grouped into the same session view. This weakens session usability, especially for debugging traces.

## Problem 2: Root Span Construction Is Likely Wrong

This appears to be the main reason Phoenix reports `rootSpan: null`.

### What the prototype does for workflow spans

For root workflows, the prototype:

1. Computes a deterministic trace ID from `trace_id` or `workflow_run_id`
2. Computes a deterministic span ID from `workflow_run_id`
3. Builds a `SpanContext` with that trace ID and span ID
4. Wraps it in `trace.NonRecordingSpan(...)`
5. Passes that as the `context=` when creating the workflow span

Relevant code:

- `/Users/yang/Downloads/arize_phoenix_trace.py:221`
- `/Users/yang/Downloads/arize_phoenix_trace.py:227`
- `/Users/yang/Downloads/arize_phoenix_trace.py:283`
- `/Users/yang/Downloads/arize_phoenix_trace.py:288`

### Why this is suspicious

For a true root span, the span should usually be created without a parent context.

Instead, the prototype appears to create the workflow span inside an already-populated context built from a `NonRecordingSpan`.

That suggests Phoenix may interpret the supposed root span as:

- a child of a synthetic parent
- a self-parented span
- or a span whose parent chain cannot be resolved into a valid root

Even if the OTEL SDK accepts this, Phoenix may still fail to identify a valid canonical root span for the trace.

## Refined Interpretation From The Trace Detail Response

The newer Phoenix response changes the diagnosis in an important way.

It shows that the prototype trace is not completely missing a root-like span. Instead:

- Phoenix trace detail can still expose a `rootSpans` entry
- but the selected span still has a non-empty `parentId`
- and that parent is not part of the trace payload

This strongly suggests the workflow span is being treated as an orphan root:

- it behaves like a root for trace-detail display
- but it is not a clean canonical root with `parentId = null`

That distinction likely explains the product behavior difference:

- trace detail view is tolerant and can still render an orphan-root tree
- session view appears stricter and expects a canonical root span

Under that interpretation, the prototype's real failure mode is:

- hierarchy can still look correct in trace detail
- but session-level root resolution fails
- therefore `session.traces[].rootSpan` becomes `null`

## Why the session query result matches this diagnosis

The observed session query shows:

- the session exists
- traces are counted
- each trace record exists
- but `rootSpan` is `null` for every trace

The observed trace-detail query also shows:

- `rootSpans.edges` exists
- but the selected root-like span still has a non-empty `parentId`

Together, that pattern strongly suggests:

- traces were ingested
- session-level indexing found them
- Phoenix could find an orphan-root candidate for trace detail
- but Phoenix could not compute a valid canonical root span record for session usage

This is more consistent with malformed root-span parentage than with a pure session problem.

## Combined Interpretation

The prototype's visible session problem is probably not caused primarily by Phoenix sessions themselves.

It is more likely:

1. workflow root spans are not emitted as true canonical roots
2. Phoenix may still render them as orphan roots in trace detail
3. Phoenix cannot resolve a canonical `rootSpan` for session queries
4. session pages depend on canonical root spans to render trace trees
5. inconsistent `session.id` on child spans makes the session experience even weaker

## Practical Takeaway

If we re-implement this on `origin/main`, we should treat these as two separate requirements:

1. Ensure real root spans exist
   - root workflow span should not be created under a fake parent context
   - nested child workflow spans may use explicit parent tool span context
   - root workflows should remain true roots
2. Ensure stable session propagation
   - all spans in the same logical session should use the same session ID
   - debugging mode likely needs `workflow_id` fallback for node spans too, not only for workflow root spans

## Current Working Hypothesis

The prototype's session display issue is likely not a Phoenix UI bug.

It is more likely a tracing construction bug:

- root workflow spans are created with an invalid parent context
- Phoenix may tolerate them as orphan roots in trace detail
- Phoenix cannot determine a canonical `rootSpan` for sessions
- child spans also have incomplete `session.id` propagation in debugging mode

That combination explains why:

- traces exist
- sessions exist
- trace detail can still show hierarchy
- but session pages still show no usable canonical root trace data
