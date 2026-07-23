# Agent Resource Collection 路由到 Retention 队列

## 1. 背景与问题

`collect_agent_resources` 已作为统一的异步物理资源清理任务注册到 Celery。产品事务同步把 Workspace、Binding 和 HomeSnapshot 标记为 `RETIRED`，commit 后由 `enqueue_agent_resource_collection` 使用 `.delay()` 发送 collection task。

当前 task 使用：

```python
@shared_task
def collect_agent_resources(...):
    ...
```

未指定 queue 时，Celery 把消息发送到隐式默认队列 `celery`。

Dify self-hosted worker 并不监听这个隐式队列。worker entrypoint 使用显式 `-Q` 列表启动，只消费 `dataset`、`workflow`、`retention` 等命名队列。因此当前状态是：

```text
retire transaction commit
  -> collect_agent_resources.delay()
  -> message enters "celery"
  -> no worker consumes it
  -> RETIRED rows and physical resources remain indefinitely
```

本地 E2B Compose 验证已经确认：

- worker 正常注册 `tasks.collect_agent_resources_task.collect_agent_resources`；
- worker 的 active queues 包含 `retention`，不包含 `celery`；
- 不指定 queue 的无副作用 collection smoke task 未被消费；
- 同一个 task 显式发送到 `retention` 后被当前 worker 接收并成功执行。

因此问题不是 task 注册、Redis 连接、collector 实现或 Compose 健康状态，而是 task 缺少符合 Dify worker 契约的显式路由。

## 2. 目标

1. 让所有通过 `enqueue_agent_resource_collection` 发送的 collection task 落入当前标准 worker 已监听的队列。
2. 不改变同步 retire、commit 后 enqueue、异步 collect 的生命周期边界。
3. 不新增 Celery queue、worker、环境变量或 Compose 配置。
4. 用最小测试防止 task 以后退回无人消费的隐式默认队列。

## 3. 非目标

本方案不处理：

- 新建 Agent resource 专用队列；
- collection retry、backoff、TTL 或 dead-letter queue；
- outbox 或可靠投递；
- collector 并发、批处理或性能优化；
- Celery 全局默认队列配置；
- worker queue 自动发现；
- Runtime Resource GC/reconciler；
- task/service import 结构重构；
- lifecycle schema 或 backend protocol 变更。

## 4. 方案

### 4.1 使用现有 Retention 队列

把 task 声明改为：

```python
@shared_task(queue="retention")
def collect_agent_resources(...):
    ...
```

`enqueue_agent_resource_collection` 继续调用：

```python
collect_agent_resources.delay(...)
```

Celery task 自身的 `queue="retention"` 元数据会让 `.delay()` 自动路由到 `retention`，调用方不需要重复指定 queue。

不在 enqueue helper 中改成 `apply_async(queue="retention")`，原因是 queue 属于 task 的执行契约，应在 task 声明处集中定义。这样所有调用方式都使用同一队列，也与仓库中现有 `@shared_task(queue="...")` 的模式一致。

### 4.2 为什么选择 Retention

Agent resource collection 的业务语义是：

```text
产品生命周期已经提交
  -> 后台清理不再使用的物理资源
```

这与现有 `retention` 队列承载的过期 Workflow Run、消息、日志和 OAuth token 清理属于同一类后台维护工作。

其他选择不合适：

- `app_deletion`：collection 还来自 Build、Conversation、Roster 和 Workflow terminal，并不只属于 App Delete。
- `workflow`：collection 不是 Workflow 专属。
- `conversation`：同样只覆盖部分来源。
- 隐式 `celery`：标准 worker 不监听。
- 新专用队列：当前负载和产品阶段不值得增加部署复杂度。

当前 self-hosted 普通 worker 已监听 `retention`，所以这个修改不需要新增或重建 worker 类型。自定义部署若裁剪 `CELERY_WORKER_QUEUES`，必须保留 `retention` 才能执行包括 Agent collection 在内的后台维护任务。

### 4.3 不改变生命周期与失败语义

路由修复不改变现有流程：

```text
product transaction
  -> retire ledger rows
  -> commit

after commit
  -> enqueue collection to retention
  -> return product result

worker
  -> collect Workspace
  -> collect Binding
  -> collect HomeSnapshot
```

以下语义保持不变：

- commit 失败不 enqueue；
- enqueue 失败只记录日志，不回滚产品事务；
- 单个资源 collection 失败不阻止同一 task 中的其他资源；
- 物理删除失败保留 `RETIRED` ledger row；
- 重复 task 依赖现有 collector 幂等处理；
- queue 选择不会自动增加 retry、优先级、TTL 或 GC 状态。

## 5. 代码改动

### 5.1 Task

修改：

- `api/tasks/collect_agent_resources_task.py`

仅给 `collect_agent_resources` 增加 `queue="retention"`。

不修改：

- task 参数；
- `enqueue_agent_resource_collection`；
- 所有产品调用点；
- collector 顺序和异常处理；
- `api/extensions/ext_celery.py` 的 task import 注册。

### 5.2 测试

修改：

- `api/tests/unit_tests/tasks/test_collect_agent_resources_task.py`

增加一个直接的路由契约测试：

```python
def test_collection_task_uses_retention_queue() -> None:
    assert getattr(collect_agent_resources, "queue", None) == "retention"
```

该测试只验证真正导致故障的 task metadata，不 mock broker、不启动 worker，也不重复已有 enqueue 和 collector 测试。

现有测试继续覆盖：

- 空输入不 enqueue；
- ID 去重和稳定排序；
- Workspace、Binding、HomeSnapshot collection 顺序；
- 单个 collector 失败后继续；
- enqueue failure 为 best effort。

### 5.3 文档

修改：

- `dify-agent/docs/dify-agent/concepts/runtime-resources/index.md`

把“uses default routing”修正为：

- unified collection task 显式使用现有 `retention` queue；
- standard worker 已消费该 queue；
- 不需要专用 Agent resource worker 或新 queue。

`.context/proposals/260723-synchronous-retire-asynchronous-collect.md` 保留为当时的设计记录。本 proposal 仅覆盖其中“使用默认 Celery 路由”的决定。

## 6. 基础设施影响

无数据库或 backend 资源变化：

- 不新增 migration；
- 不新增 Redis key schema；
- 不新增 Celery queue；
- 不修改 Compose；
- 不修改 `.env`；
- 不修改 Local、E2B 或 Enterprise runtime backend。

`retention` 已存在于标准 worker 的默认 queue 列表。部署只需重新构建并重启包含 API 代码的 API、worker、worker beat 和 websocket 镜像；实际执行 collection 的关键组件是 worker。

## 7. 实现步骤

1. 在 `collect_agent_resources` 的 `@shared_task` 上声明 `queue="retention"`。
2. 在现有 task 单测文件增加 queue metadata 断言。
3. 更新 runtime resources 文档中的默认路由表述。
4. 运行相关 task 单测、Ruff 和 `git diff --check`。
5. 重新构建本地 E2B Compose 的 Dify API 镜像并重启相关服务。
6. 通过正式 Celery app 调用 `collect_agent_resources.delay()` 发送空资源列表的无副作用 smoke task。
7. 在 worker 日志中确认该 task 被接收并成功执行，同时确认没有消息落入无人监听的 `celery` 队列。

## 8. 验收标准

1. `collect_agent_resources.queue == "retention"`。
2. `enqueue_agent_resource_collection` 仍使用 `.delay()`，调用方不感知 queue。
3. 标准 self-hosted worker 能接收并执行 collection task。
4. task 不再向隐式 `celery` 队列发送消息。
5. 不新增 queue、worker、环境变量、Compose 配置或兼容 fallback。
6. retire/commit/enqueue/collect 的事务与失败语义没有变化。
7. runtime resources 文档与实际路由一致。
