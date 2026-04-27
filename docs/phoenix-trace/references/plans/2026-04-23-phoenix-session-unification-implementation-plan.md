# Phoenix Session Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make nested workflows triggered from a top-level workflow land in the same Phoenix session as the parent workflow, without changing upstream tracing code.

**Architecture:** Keep all production changes inside the Phoenix provider package. Reuse upstream `conversation_id`, `workflow_run_id`, and `parent_trace_context.parent_workflow_run_id`, then adjust Phoenix-local session fallback resolution for workflow spans and workflow node spans.

**Out of scope:** Do not change upstream trace contracts. Do not change synthetic-root display behavior. Do not attempt to fix Phoenix session summary `firstInput` / `lastOutput` in this plan.

---

## Files

### Production

- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  Purpose:
  - change workflow session fallback order
  - add a short transitional comment describing future upstream migration

### Tests

- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
  Purpose:
  - update helper-level session fallback expectations

- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
  Purpose:
  - update workflow-level nested session expectations
  - preserve existing trace-root reuse assertions

---

## Task 1: Lock In The New Session Rule With Tests

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] Add or update helper-level tests so that workflow session resolution expects:
  - `conversation_id` first
  - then `parent_workflow_run_id`
  - then current `workflow_run_id`

- [ ] Update workflow-level tests so that nested workflows without `conversation_id` are expected to emit:
  - workflow span `session.id = outer workflow_run_id`
  - child node spans `session.id = outer workflow_run_id`

- [ ] Keep the existing assertions that nested workflows still reuse the parent trace root context.

- [ ] Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

- [ ] Commit the red or expectation-update checkpoint.

## Task 2: Change Phoenix-Local Session Resolution

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

- [ ] Update `_resolve_workflow_session_id()` so the fallback order becomes:

```python
conversation_id
parent_workflow_run_id
workflow_run_id
```

- [ ] Reuse `_resolve_workflow_parent_context()` rather than reparsing metadata separately.

- [ ] Add or refine a short code comment that makes the transitional intent explicit:
  - this is a Phoenix-local fallback
  - future upstream session fields should replace this inference

- [ ] Ensure the resulting session id is still written consistently onto:
  - workflow spans
  - workflow node spans

## Task 3: Verify, Then Commit

- [ ] Run targeted verification again:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

- [ ] If local Phoenix manual validation is available, confirm this expected behavior:
  - one top-level workflow trace
  - nested child workflow traces still appear as separate traces
  - all those traces now appear under the same Phoenix session

- [ ] Commit the implementation:

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
        api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
        api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "feat: unify phoenix sessions for nested workflows"
```
