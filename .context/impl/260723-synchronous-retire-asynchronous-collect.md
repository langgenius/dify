# Agent Working Resource Retire 与异步 Collection 实现记录

## 状态

- 日期：2026-07-23
- 状态：已完成
- Proposal：`.context/proposals/260723-synchronous-retire-asynchronous-collect.md`
- 分支：`yanli/refactor-sandbox-and-e2b`
- 实现基线：`8dbbde62f9 refactor: decouple agent working environment resources`

## 实现结果

HomeSnapshot、AgentWorkspaceBinding 和 Workspace 的生命周期边界已经统一为：

```text
产品事务内同步 retire
  -> commit
  -> best-effort enqueue
  -> Celery 异步 collect
```

`retire` 只更新数据库 ledger，`collect` 才访问 Dify Agent backend 并清理物理资源。产品请求、Workflow terminal path 和 App 后台数据删除任务不再直接执行物理 collection，也不再把首次 retire 延迟到 Celery。

本轮没有增加数据库表、migration、资源状态、outbox、专用队列、TTL、兼容分支或 fallback。

## 主要实现

### 1. 统一异步 Collection

新增 `api/tasks/collect_agent_resources_task.py`：

- `collect_agent_resources` 按 Workspace、Binding、HomeSnapshot 的顺序处理明确传入的逻辑 row ID；
- 单个资源失败只记录日志，不阻止后续资源；
- `enqueue_agent_resource_collection` 负责空输入短路、过滤空 ID、去重、稳定排序和 best-effort `.delay()`；
- enqueue 失败只记录 tenant 和逻辑资源 ID，不改变已经提交的产品结果。

新 task 已加入 Celery 显式 imports，使用现有默认路由和普通 worker，不增加新 queue 或部署配置。

删除旧的 `api/tasks/retire_workflow_agents_task.py`，不再保留负责“首次 retire”的异步任务。

### 2. 资源 Service 边界

`AgentWorkspaceService` 现在明确区分：

- `retire_binding`、`retire_workspace`：只修改调用方持有的 transaction；
- `retire_all_for_app`：在调用方 transaction 中 retire App 的全部 ACTIVE Workspaces；
- `collect_retired_binding`、`collect_retired_workspace`：读取 RETIRED ledger、调用 backend、成功后删除 ledger row。

`AgentHomeSnapshotService` 的 retire 仍是纯数据库动作，collector 仍在物理删除前检查 Config 引用。

`WorkflowAgentRetirementService` 删除 SQLAlchemy transaction listener 和 `schedule_after_commit`，新增显式 `retire_unowned` 流程：

1. 主产品事务先提交；
2. fresh session 重新检查 Workflow-only Agent ownership；
3. archive 无 owner 的 Agent，并 retire 其 Binding/HomeSnapshot；
4. 提交 fresh transaction；
5. 返回逻辑资源 ID，由调用方 enqueue 统一 collection task。

低层 workflow projection/sync 方法只显式返回候选 Agent ID，不保存隐式 session 状态。

### 3. 产品生命周期调用点

以下路径已切换为同步 retire、commit 后异步 collect：

- Build Draft Apply；
- Build Draft Discard；
- Conversation Delete；
- Debug Conversation 替换；
- Roster Agent Archive；
- Agent App Delete；
- Workflow Run terminal；
- Workflow / Snippet / DSL import、publish、delete 等可能使 Workflow-only Agent 失去 owner 的路径。

App Delete 会在 App row 删除前调用 `retire_all_for_app`，确保 App 的 ACTIVE Workspaces 在同一产品事务内进入 RETIRED。`remove_app_and_related_data_task` 不再首次决定这些资源的生命周期。

Workflow terminal layer 同步调用 workspace store 完成数据库 retire；store 返回 Workspace IDs，terminal layer 仅在 commit 成功后 enqueue collection。重复 terminal event 依赖 retire/collector 的幂等语义处理。

### 4. 删除 API 跨系统创建补偿

删除：

- `api/services/agent/resource_creation_compensation.py`；
- compensation registry、transaction wrapper 和 callback；
- Workspace/HomeSnapshot 创建路径中的 API-side destroy/delete 补偿；
- Build Apply 的 compensation 参数传递；
- 只验证旧补偿机制的测试。

现在 backend create 成功而后续 Python、flush 或 commit 失败时，Dify API 不猜测提交结果，也不立即删除外部资源。没有 ledger 的物理 orphan 留给未来基于 backend inventory、ledger 和 grace period 的全局 reconciler。

Local 和 E2B backend 内部仍保留 partial-create cleanup：create 尚未成功返回前产生的临时目录、Sandbox 或初始化资源由 backend 自己清理。这一边界已通过 backend 测试覆盖。

### 5. 文档

`dify-agent/docs/dify-agent/concepts/runtime-resources/index.md` 已同步说明：

- retire 同步、collection 异步；
- 统一 task 使用默认 Celery 路由和普通 worker；
- Workflow terminal 与 Workflow-only ownership recheck 的事务边界；
- Dify API 不做创建后的跨系统即时补偿；
- backend 只清理尚未成功返回的 partial create；
- 全局 reconcile、TTL 和 GC 尚未在本轮实现。

相关 service 和 Workflow workspace store 的 docstring 也已按实际行为更新。

## 测试与审查

实现遵循五阶段 review loop，并全部通过：

1. Proposal 完整性：通过；
2. 代码质量与死代码检查：通过；
3. 测试充分性：补齐事务顺序、commit 失败不 enqueue、真实 ownership recheck、worker task 注册及 Local/E2B partial cleanup 后通过；
4. 测试质量：删除重复和实现耦合断言后通过；
5. 文档准确性：修正事务不确定性与 backend partial-create cleanup 表述后通过。

已执行并通过的验证包括：

- API 生命周期、service、task、controller、Workflow 和 migration 相关测试；
- Dify Agent Local/E2B backend partial-create cleanup 测试；
- Ruff；
- Pyrefly production-code 检查；
- focused Mypy；
- MkDocs build；
- `git diff --check`。

容器 integration tests 属于 CI-only，本地未运行；受影响的方法签名和对应测试调用已经更新。

## 与 Proposal 的差异

没有架构性偏离。实现过程中只补充了必要的 Celery task 注册和调用点签名传播，并根据 review 删除了重复、过度耦合的测试断言。

## 工作树说明

实现尚未 commit 或 push。`dify-agent/.pdm-python` 是实现前已经存在的本地未跟踪文件，本轮未修改。
