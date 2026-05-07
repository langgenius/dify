# Provider-Neutral Trace Dispatch Retry 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 ops trace retry handling 泛化为 provider-neutral 设计，同时保留当前 Phoenix pending-parent 行为。

**架构：** `tasks.ops_trace_task` 应依赖 core retryable dispatch abstraction，而不是 Phoenix 当前使用的 pending-parent 具体 subclass。Phoenix 继续负责抛出具体 pending-parent exception，并继续拥有 Redis parent span coordination 的全部细节。

**技术栈：** Python、Celery、pytest、Dify ops trace core、Phoenix OpenTelemetry provider。

---

## 文件结构

- 修改：`api/tasks/ops_trace_task.py`
  - 将 Phoenix-specific retry 常量改为 provider-neutral 命名。
  - 捕获 `RetryableTraceDispatchError`。
  - 将 retry 日志改成 provider-neutral wording，同时保留 exception detail。
- 修改：`api/tests/unit_tests/tasks/test_ops_trace_task.py`
  - 通用 task retry 测试使用 `RetryableTraceDispatchError`。
  - 保留已有 enterprise 幂等断言。
- 保持：`api/core/ops/exceptions.py`
  - 除非需要更新 docstring wording，否则不需要行为变化。
- 保持：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  - Phoenix 继续抛出 `PendingTraceParentContextError`。

---

### Task 1: 重命名 Task 中的通用 Retry Policy

**文件：**
- 修改：`api/tasks/ops_trace_task.py`

- [ ] **Step 1: 替换 module docstring**

将 `api/tasks/ops_trace_task.py` 顶部 module docstring 改为：

```python
"""
Celery task for asynchronous ops trace dispatch.

Trace providers may report explicitly retryable dispatch failures through the
core retryable exception contract. The task preserves the payload file only
when Celery accepts the retry request; successful dispatches and terminal
failures clean up the stored payload.
"""
```

- [ ] **Step 2: import provider-neutral exception**

替换：

```python
from core.ops.exceptions import PendingTraceParentContextError
```

为：

```python
from core.ops.exceptions import RetryableTraceDispatchError
```

- [ ] **Step 3: 重命名 retry 常量**

替换：

```python
_PENDING_PHOENIX_PARENT_RETRY_LIMIT = 3
_PENDING_PHOENIX_PARENT_RETRY_DELAY_SECONDS = 5
```

为：

```python
_RETRYABLE_TRACE_DISPATCH_LIMIT = 3
_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS = 5
```

将 `@shared_task` decorator 更新为：

```python
@shared_task(
    queue="ops_trace",
    bind=True,
    max_retries=_RETRYABLE_TRACE_DISPATCH_LIMIT,
    default_retry_delay=_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS,
)
```

- [ ] **Step 4: 重命名 retry exception 分支**

将 retry branch 替换为：

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

- [ ] **Step 5: 检查 task 中是否还存在 Phoenix-specific retry 命名**

运行：

```bash
rg -n "PENDING_PHOENIX|Phoenix parent|PendingTraceParentContextError" api/tasks/ops_trace_task.py
```

预期：无匹配。

---

### Task 2: 将通用 Task 测试改为使用 Base Retry Contract

**文件：**
- 修改：`api/tests/unit_tests/tasks/test_ops_trace_task.py`

- [ ] **Step 1: 替换测试 import**

替换：

```python
from core.ops.exceptions import PendingTraceParentContextError
```

为：

```python
from core.ops.exceptions import RetryableTraceDispatchError
```

- [ ] **Step 2: 添加 retryable failure helper**

在已有 test helper 附近添加：

```python
def _retryable_dispatch_error() -> RetryableTraceDispatchError:
    return RetryableTraceDispatchError("transient trace dispatch failure")
```

- [ ] **Step 3: 替换 task test 中的 pending-parent error**

在 `api/tests/unit_tests/tasks/test_ops_trace_task.py` 中，将每个 task-level setup：

```python
pending_error = PendingTraceParentContextError("parent-node-execution-id")
```

替换为：

```python
pending_error = _retryable_dispatch_error()
```

如果修改变量名会制造噪音，可以保留 `pending_error` 这个变量名；这里测试的是 retryable task path。

- [ ] **Step 4: 只在必要时更新测试名**

如果测试名明确提到 Phoenix parent retry，将其改成 provider-neutral 名字：

```python
def test_process_trace_tasks_retries_retryable_dispatch_failure_and_preserves_payload():
    ...

def test_process_trace_tasks_deletes_payload_and_counts_exhausted_retryable_dispatch_failure():
    ...
```

除非旧名字已经误导，否则不需要重命名 enterprise retry 幂等相关测试。

- [ ] **Step 5: 运行 task tests**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

预期：该文件全部测试通过。

---

### Task 3: 验证 Phoenix 仍然使用具体 Pending-Parent Signal

**文件：**
- 检查：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- 检查：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- 检查：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: 确认 Phoenix 仍 import 具体 exception**

运行：

```bash
rg -n "PendingTraceParentContextError" api/providers/trace/trace-arize-phoenix
```

预期：Phoenix provider code 和 Phoenix provider tests 中仍然有匹配。

- [ ] **Step 2: 运行 focused Phoenix pending-parent tests**

运行：

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

预期：Phoenix provider tests 通过。如果本地环境 setup 导致这些 provider tests 无法运行，记录准确失败原因，并至少运行 Task 2 的 task tests。

---

### Task 4: 最终验证与 Commit

**文件：**
- 验证：`api/tasks/ops_trace_task.py`
- 验证：`api/tests/unit_tests/tasks/test_ops_trace_task.py`
- 验证：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

- [ ] **Step 1: 运行 boundary search**

运行：

```bash
rg -n "PENDING_PHOENIX|Phoenix parent|PendingTraceParentContextError" api/tasks/ops_trace_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py
```

预期：通用 task 和通用 task tests 中无匹配。

- [ ] **Step 2: 再次运行 focused task tests**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

预期：全部测试通过。

- [ ] **Step 3: review diff**

运行：

```bash
git diff -- api/tasks/ops_trace_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py
```

预期：diff 只泛化 retry dispatch 命名并改为捕获 `RetryableTraceDispatchError`；不改变 payload cleanup 语义。

- [ ] **Step 4: commit implementation**

运行：

```bash
git add api/tasks/ops_trace_task.py api/tests/unit_tests/tasks/test_ops_trace_task.py
git commit -m "refactor: generalize trace dispatch retry handling"
```

预期：commit 成功，且只包含 provider-neutral retry cleanup。
