# Provider-Neutral Trace Dispatch Retry 规格

日期：2026-04-27
状态：Spec
来源：对 `api/tasks/ops_trace_task.py` 的 SOLID review

## 总结

`api/tasks/ops_trace_task.py` 现在已经不再 import Phoenix provider 代码，但通用 trace dispatch task 里仍然在命名、日志和捕获的具体异常类型上编码了 Phoenix 语义。作为过渡修复可以接受，但这会让通用 task 对当前某一个 provider 的失败模式保持开放修改压力。

这份规格把边界进一步收紧：retryable trace dispatch 应该是 provider-neutral 的 core contract。Phoenix 仍然是当前唯一会产生 pending-parent 条件的 provider，但 task 应该通过同一个抽象处理所有明确声明为 retryable 的 trace dispatch failure。

## 目标

1. 保持 Phoenix nested workflow pending-parent retry 行为不变。
2. 让 `tasks.ops_trace_task` 依赖 provider-neutral 的 core exception contract。
3. 从通用 task 的命名和日志中移除 Phoenix-specific 表达。
4. Phoenix-specific Redis parent span coordination 继续留在 Phoenix provider 内。
5. 保留 enterprise trace retry 幂等和 payload 清理语义。

## 非目标

- 不引入共享 Redis parent span context store。
- 不重设计 trace provider interface。
- 不改变 Phoenix span hierarchy、session 语义或 span naming。
- 不改变 trace payload schema，已有的 retry-local 私有 metadata 如 `_enterprise_trace_dispatched` 除外。
- 不把所有 provider failure 都变成 retryable；只有明确抛出 core retryable exception 的失败才 retry。

## 需求

### 1. 通用 Retryable Dispatch Contract

通用 task 必须捕获 provider-neutral base exception：

- `RetryableTraceDispatchError` 继续作为 transient trace dispatch failure 的 core base class。
- `PendingTraceParentContextError` 继续作为当前 nested trace parent-context 条件的具体 subclass。
- `process_trace_tasks` 捕获 `RetryableTraceDispatchError`，而不是 `PendingTraceParentContextError`。
- provider-specific 细节可以出现在 exception message 里，但不能出现在 task control-flow 命名里。

### 2. Provider-Neutral Task 命名

task 中的通用 retry policy 不应使用 Phoenix-specific identifier：

- `_PENDING_PHOENIX_PARENT_RETRY_LIMIT` 应改为 `_RETRYABLE_TRACE_DISPATCH_LIMIT`。
- `_PENDING_PHOENIX_PARENT_RETRY_DELAY_SECONDS` 应改为 `_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS`。
- 日志应使用 "retryable trace dispatch failure" 或等价的 provider-neutral 表达。

### 3. Phoenix Provider 边界

Phoenix 继续负责 Phoenix-only mechanics：

- Redis key shape：`trace:phoenix:parent_span:{parent_node_execution_id}`。
- parent span carrier 的 TTL。
- carrier JSON validation。
- OpenTelemetry traceparent validation 和 context restoration。
- 当 parent carrier 暂不可用时 raise `PendingTraceParentContextError`。

### 4. Retry 与 Cleanup 语义

清理行为必须保持不变：

- trace dispatch 成功后删除 stored payload。
- terminal trace dispatch failure 递增 failed counter 并删除 payload。
- Celery retry 成功调度时保留 stored payload。
- retry 调度失败时递增 failed counter 并删除 payload。
- enterprise telemetry 已经执行过时，retry 前继续持久化 `_enterprise_trace_dispatched`。

## 验收标准

- `api/tasks/ops_trace_task.py` import 并捕获 `RetryableTraceDispatchError`。
- `api/tasks/ops_trace_task.py` 不再包含 Phoenix-specific retry policy 常量名。
- 通用 task 日志使用 provider-neutral retry language。
- Phoenix 测试仍然断言 missing parent span carrier 会抛出 `PendingTraceParentContextError`。
- task 测试通过 base `RetryableTraceDispatchError` 覆盖 retry 行为。
- 现有 enterprise trace 幂等测试继续通过。
- 通用 task 层的生产代码不 import Phoenix provider exception。

## 风险

主要风险是意外扩大 retry 行为。捕获 base class 只有在该 base class 专门保留给明确 retryable 的 provider signal 时才安全。实现不能在 retry path 捕获任意 provider exception、`RuntimeError` 或 `Exception`。

第二个风险是丢失诊断信息。provider-neutral task 日志仍应包含 exception message，让 Phoenix-specific parent-node context 继续可观测，但不要把 Phoenix 编进通用 task。
