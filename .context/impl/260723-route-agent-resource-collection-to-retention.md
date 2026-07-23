# Agent Resource Collection 路由到 Retention 队列实现记录

## 状态

- 日期：2026-07-23
- 状态：已完成
- Proposal：`.context/proposals/260723-route-agent-resource-collection-to-retention.md`
- 分支：`yanli/refactor-sandbox-and-e2b`

## 问题

`collect_agent_resources` 原先使用没有 queue 参数的 `@shared_task`。调用 `.delay()` 时，Celery 把消息发送到隐式 `celery` 默认队列，但 Dify self-hosted worker 使用显式 `-Q` 列表启动，并不监听这个队列。

结果是 task 虽然已注册，消息却不会被 worker 消费，已经进入 `RETIRED` 的 ledger row 和对应物理资源会继续保留。

本地 E2B Compose 已复现：

- worker 注册了 collection task；
- worker 监听 `retention`，不监听 `celery`；
- 默认路由消息未被消费；
- 显式发送到 `retention` 的同一无副作用 task 可以执行。

## 实现

### Task 路由

`api/tasks/collect_agent_resources_task.py` 中的 task 声明改为：

```python
@shared_task(queue="retention")
```

`enqueue_agent_resource_collection` 继续使用 `.delay()`。queue 契约集中在 task 声明处，调用方、task payload、collector 顺序和失败语义均未改变。

没有新增 queue、worker、环境变量、Compose 配置或路由 fallback。

### 测试

`api/tests/unit_tests/tasks/test_collect_agent_resources_task.py` 增加一个直接的 metadata 契约测试：

```python
assert getattr(collect_agent_resources, "queue", None) == "retention"
```

没有增加 broker mock、worker fixture 或重复验证已有 enqueue/collector 行为的测试。

### 文档

`dify-agent/docs/dify-agent/concepts/runtime-resources/index.md` 已把错误的“default routing”说明改为：

- collection task 显式使用现有 `retention` queue；
- standard worker 已消费该 queue；
- 不需要新的 Agent resource queue 或专用 worker。

## 验证

代码验证：

- focused task tests：4 passed；
- Ruff：通过；
- `git diff --check`：通过。

cmd-impl review：

- Stage 1 proposal 完整性：PASS；
- Stage 2 代码与逻辑整洁性：PASS；
- Stage 3 测试充分性：按用户要求跳过；
- Stage 4 测试整洁性：PASS；
- Stage 5 文档准确性：PASS。

本地 E2B Compose：

- `dify-api:e2b-local` 与 `dify-agent-backend:e2b-local` 已从当前工作树重建；
- API migration 成功；
- API、worker、worker beat、websocket、agent backend 和 nginx 均正常启动；
- Web 入口和 localhost Agent Backend 健康检查通过；
- 使用正式 Celery app 调用 `collect_agent_resources.delay()`：
  - task queue metadata 为 `retention`；
  - 调用前后隐式 `celery` queue 长度均为 0；
  - worker 日志确认相同 task ID 被接收并成功执行。

## 与 Proposal 的差异

无差异。实现只修改 proposal 指定的三个文件，没有扩展生命周期、Celery 或部署架构。

## 工作树

本轮更改尚未 commit 或 push。`dify-agent/.pdm-python` 是既有本地未跟踪文件，本轮未修改。
