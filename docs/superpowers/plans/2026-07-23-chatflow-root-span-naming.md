# Chatflow Root Span Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename unified tracing Chatflow root spans from `message` to `chatflow_<workflow_run_id>` without changing standalone Message or Workflow spans.

**Architecture:** Keep naming centralized in `CanonicalTraceBuilder._build_workflow`, where the presence of `message_id` already identifies the Chatflow root path. Update one focused builder test first, then make the one-line production change; provider adapters remain unchanged.

**Tech Stack:** Python, Pydantic canonical trace models, pytest

---

## File Structure

- Modify `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py` to lock the Chatflow root naming contract.
- Modify `api/core/ops/unified_trace/trace_builder.py` to derive the Chatflow root name from `workflow_run_id`.

### Task 1: Rename Chatflow Root Span

**Files:**
- Modify: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py:130-151`
- Modify: `api/core/ops/unified_trace/trace_builder.py:166-181`

- [ ] **Step 1: Write the failing test**

Add the root-name assertion to the existing Chatflow behavior test:

```python
def test_chatflow_message_uses_query_while_workflow_keeps_complete_inputs():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(
        workflow_info(
            message_id="message-1",
            query="hi",
            workflow_run_inputs=CHATFLOW_INPUTS,
        )
    )

    assert trace is not None
    spans = {span.id: span for span in trace.spans}
    assert spans["message-1"].name == "chatflow_run-1"
    assert spans["message-1"].inputs == "hi"
    assert spans["message-1"].metadata["trace_entity_type"] == "message"
    assert spans["message-1"].publishes_parent_context is True
    assert spans["run-1"].name == "workflow_run-1"
    assert spans["run-1"].inputs == CHATFLOW_INPUTS
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_chatflow_message_uses_query_while_workflow_keeps_complete_inputs -q
```

Expected: FAIL because the Chatflow root name is currently `message`.

- [ ] **Step 3: Write the minimal implementation**

In the `if trace_info.message_id:` branch of `CanonicalTraceBuilder._build_workflow`, change only the span name:

```python
spans[root_id] = CanonicalSpan(
    id=root_id,
    parent_id=None,
    name=f"chatflow_{trace_info.workflow_run_id}",
```

Keep the span ID, metadata, hierarchy, inputs, outputs, and parent-context flags unchanged.

- [ ] **Step 4: Run focused and nearby tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q
```

Expected: all tests pass, including existing standalone Message assertions that retain the name `message` and Workflow assertions that retain `workflow_<workflow_run_id>`.

- [ ] **Step 5: Run formatting and diff checks**

Run:

```bash
uv run --project api ruff check api/core/ops/unified_trace/trace_builder.py api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py
git diff --check
```

Expected: both commands exit successfully with no findings.

- [ ] **Step 6: Commit the implementation**

```bash
git add api/core/ops/unified_trace/trace_builder.py api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py
git commit -m "fix(trace): identify chatflow root spans by run"
```
