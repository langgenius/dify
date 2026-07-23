# Trace Parent Retry Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default trace-parent retry window cover Dify's default maximum workflow execution time plus a 300-second scheduling and export grace period.

**Architecture:** Keep the existing fixed-delay Celery retry mechanism and change only its default retry budget. Document the formula connecting retry count, retry delay, and workflow execution timeout.

**Tech Stack:** Python, Pydantic settings, Celery, pytest.

---

### Task 1: Align retry defaults

**Files:**
- Modify: `api/configs/feature/__init__.py`
- Modify: `api/.env.example`
- Modify: `docker/envs/core-services/shared.env.example`
- Test: `api/tests/unit_tests/tasks/test_ops_trace_task.py`

- [ ] Change the retry-window test to assert:

```python
def test_process_trace_tasks_default_retry_window_covers_workflow_and_export_grace_period():
    assert (
        process_trace_tasks.max_retries * process_trace_tasks.default_retry_delay
        >= dify_config.WORKFLOW_MAX_EXECUTION_TIME + 300
    )
```

- [ ] Run the test and verify it fails with the current 1,200-second retry window, which has no grace period.

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py::test_process_trace_tasks_default_retry_window_covers_workflow_and_export_grace_period -q
```

- [ ] Change the default and environment examples from 60 to 300. Add this comment above the settings fields:

```python
# Include scheduling and export grace after the parent workflow's maximum execution time.
# Recommended: max_retries >= ceil((WORKFLOW_MAX_EXECUTION_TIME + grace_seconds) / delay_seconds).
```

- [ ] Run the complete task test file, Ruff, and targeted type checks.

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
uv run --project api ruff format --check api/configs/feature/__init__.py api/tests/unit_tests/tasks/test_ops_trace_task.py
uv run --project api ruff check api/configs/feature/__init__.py api/tests/unit_tests/tasks/test_ops_trace_task.py
make type-check PATH_TO_CHECK='api/configs/feature/__init__.py api/tasks/ops_trace_task.py'
```

- [ ] Commit only feature files; keep the local Squid template out of the commit.

```bash
git add api/configs/feature/__init__.py api/.env.example docker/envs/core-services/shared.env.example api/tests/unit_tests/tasks/test_ops_trace_task.py
git commit -m "fix(trace): align parent retry window with workflow timeout"
```
