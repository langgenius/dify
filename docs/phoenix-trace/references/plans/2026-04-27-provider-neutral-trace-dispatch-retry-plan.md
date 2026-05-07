# Provider-Neutral Trace Dispatch Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ops trace retry handling provider-neutral while preserving current Phoenix pending-parent behavior.

**Architecture:** `tasks.ops_trace_task` should depend on the core retryable dispatch abstraction instead of the Phoenix-specific pending-parent subclass. Phoenix remains responsible for raising the specific pending-parent exception and for all Redis parent span coordination.

**Tech Stack:** Python, Celery, pytest, Dify ops trace core, Phoenix OpenTelemetry provider.

---

## File Structure

- Modify: `api/tasks/ops_trace_task.py`
  - Replace Phoenix-specific retry constants with provider-neutral names.
  - Catch `RetryableTraceDispatchError`.
  - Update retry logs to provider-neutral wording while preserving exception detail.
- Modify: `api/tests/unit_tests/tasks/test_ops_trace_task.py`
  - Use `RetryableTraceDispatchError` in generic task retry tests.
  - Keep existing enterprise idempotency assertions.
- Keep: `api/core/ops/exceptions.py`
  - No behavior change required unless docstrings need wording updates.
- Keep: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  - Phoenix should continue raising `PendingTraceParentContextError`.

---

### Task 1: Rename Generic Retry Policy in the Task

**Files:**
- Modify: `api/tasks/ops_trace_task.py`

- [ ] **Step 1: Replace the module docstring**

Change the top module docstring in `api/tasks/ops_trace_task.py` to:

```python
"""
Celery task for asynchronous ops trace dispatch.

Trace providers may report explicitly retryable dispatch failures through the
core retryable exception contract. The task preserves the payload file only
when Celery accepts the retry request; successful dispatches and terminal
failures clean up the stored payload.
"""
```

- [ ] **Step 2: Import the provider-neutral exception**

Replace:

```python
from core.ops.exceptions import PendingTraceParentContextError
```

with:

```python
from core.ops.exceptions import RetryableTraceDispatchError
```

- [ ] **Step 3: Rename retry constants**

Replace:

```python
_PENDING_PHOENIX_PARENT_RETRY_LIMIT = 3
_PENDING_PHOENIX_PARENT_RETRY_DELAY_SECONDS = 5
```

with:

```python
_RETRYABLE_TRACE_DISPATCH_LIMIT = 3
_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS = 5
```

Update the `@shared_task` decorator to:

```python
@shared_task(
    queue="ops_trace",
    bind=True,
    max_retries=_RETRYABLE_TRACE_DISPATCH_LIMIT,
    default_retry_delay=_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS,
)
```

- [ ] **Step 4: Rename the retry exception branch**

Replace the retry branch with:

```python
    except RetryableTraceDispatchError as e:
        if self.request.retries >= _RETRYABLE_TRACE_DISPATCH_LIMIT:
            logger.exception("Retryable trace dispatch budget exhausted, app_id: %s", app_id)
            failed_key = f"{OPS_TRACE_FAILED_KEY}_{app_id}"
            redis_client.incr(failed_key)
        else:
            logger.warning(
                "Retryable trace dispatch failure, scheduling retry %s/%s for app_id %s: %s",
                self.request.retries + 1,
                _RETRYABLE_TRACE_DISPATCH_LIMIT,
                app_id,
                e,
            )
            try:
                if enterprise_trace_dispatched:
                    storage.save(file_path, json.dumps(file_data).encode("utf-8"))
                raise self.retry(exc=e, countdown=_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS)
            except Retry:
                should_delete_file = False
                raise
            except Exception:
                logger.exception("Failed to schedule trace dispatch retry, app_id: %s", app_id)
                failed_key = f"{OPS_TRACE_FAILED_KEY}_{app_id}"
                redis_client.incr(failed_key)
```

- [ ] **Step 5: Check for remaining Phoenix-specific retry names in the task**

Run:

```bash
rg -n "PENDING_PHOENIX|Phoenix parent|PendingTraceParentContextError" api/tasks/ops_trace_task.py
```

Expected: no matches.

---

### Task 2: Update Generic Task Tests to Use the Base Retry Contract

**Files:**
- Modify: `api/tests/unit_tests/tasks/test_ops_trace_task.py`

- [ ] **Step 1: Replace the test import**

Replace:

```python
from core.ops.exceptions import PendingTraceParentContextError
```

with:

```python
from core.ops.exceptions import RetryableTraceDispatchError
```

- [ ] **Step 2: Add a local helper for retryable failures**

Near the existing test helpers, add:

```python
def _retryable_dispatch_error() -> RetryableTraceDispatchError:
    return RetryableTraceDispatchError("transient trace dispatch failure")
```

- [ ] **Step 3: Replace task-test pending-parent errors**

In `api/tests/unit_tests/tasks/test_ops_trace_task.py`, replace each task-level setup like:

```python
pending_error = PendingTraceParentContextError("parent-node-execution-id")
```

with:

```python
pending_error = _retryable_dispatch_error()
```

Keep the variable name if changing it would create noisy diffs; the behavior under test is the retryable task path.

- [ ] **Step 4: Update any test names only if needed**

If test names explicitly mention Phoenix parent retry, rename them to provider-neutral names:

```python
def test_process_trace_tasks_retries_retryable_dispatch_failure_and_preserves_payload():
    ...

def test_process_trace_tasks_deletes_payload_and_counts_exhausted_retryable_dispatch_failure():
    ...
```

Do not rename tests that are specifically about enterprise retry idempotency unless the old name becomes misleading.

- [ ] **Step 5: Run the task tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: all tests in the file pass.

---

### Task 3: Verify Phoenix Still Uses the Specific Pending-Parent Signal

**Files:**
- Inspect: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Inspect: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- Inspect: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Confirm Phoenix still imports the specific exception**

Run:

```bash
rg -n "PendingTraceParentContextError" api/providers/trace/trace-arize-phoenix
```

Expected: matches remain in Phoenix provider code and Phoenix provider tests.

- [ ] **Step 2: Run focused Phoenix pending-parent tests**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

Expected: Phoenix provider tests pass. If unrelated environment setup prevents running these provider tests locally, record the exact failure and still run the task tests from Task 2.

---

### Task 4: Final Verification and Commit

**Files:**
- Verify: `api/tasks/ops_trace_task.py`
- Verify: `api/tests/unit_tests/tasks/test_ops_trace_task.py`
- Verify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

- [ ] **Step 1: Run a boundary search**

Run:

```bash
rg -n "PENDING_PHOENIX|Phoenix parent|PendingTraceParentContextError" api/tasks/ops_trace_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py
```

Expected: no matches in the generic task or generic task tests.

- [ ] **Step 2: Run focused task tests again**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: all tests pass.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff -- api/tasks/ops_trace_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py
```

Expected: the diff only generalizes retry dispatch naming and catches `RetryableTraceDispatchError`; it does not change payload cleanup semantics.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add api/tasks/ops_trace_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py
git commit -m "refactor: generalize trace dispatch retry handling"
```

Expected: commit succeeds with only the provider-neutral retry cleanup.
