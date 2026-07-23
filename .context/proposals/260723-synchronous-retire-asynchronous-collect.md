# Agent Working Resource Retire 与异步 Collection 实现方案

## 1. 目标

统一 HomeSnapshot、AgentWorkspaceBinding 和 Workspace 的生命周期执行边界：

1. 产品生命周期变化同步写入数据库。
2. `retire` 是纯数据库状态转换，不调用 Dify Agent。
3. `collect` 在 retire 事务提交后通过 Celery 异步执行。
4. 删除 Dify API 层的即时创建补偿，创建失败遗留的物理孤儿由未来全局 reconciler 处理。
5. 保持实现简单：不增加 lifecycle task 表、outbox、retry 状态机、TTL、`creating`/`cleaned` 状态或 ORM transaction listener。

本方案只调整已经实现的 working-environment 资源生命周期，不改变 HomeSnapshot、Workspace、Binding、RuntimeLease 的抽象和 backend protocol。

## 2. 非目标

本轮不实现：

- 全局 backend inventory reconcile；
- 定时扫描 GC、年龄 TTL 或资源保留策略；
- Celery 投递可靠性表、outbox 或独立任务状态；
- collection 的复杂 retry/backoff；
- 新的数据库 migration；
- 新的 Celery 专用 queue；
- Enterprise backend 的完整资源实现；
- 私有文件接口或 Workspace 文件语义的重命名；
- 旧 lifecycle 行为的兼容 route、alias、fallback 或双写。

## 3. 核心决策

### 3.1 Retire 与 Collect 分离

资源状态机保持：

```text
ACTIVE
  |
  | product lifecycle transaction
  v
RETIRED
  |
  | asynchronous physical collection succeeds
  v
ledger row deleted
```

- `ACTIVE -> RETIRED` 由产品 use case 同步完成。
- retire 时清空 `active_guard`、写入 `retired_at` 并保留 backend ref。
- collection 只接受稳定的逻辑 row ID，在内部重新读取 RETIRED row 和 opaque backend ref。
- 物理删除成功后直接删除 ledger row。
- 物理删除失败时保留 RETIRED row，供未来 GC/reconciler 继续处理。
- 不增加 `CLEANED` tombstone。

RuntimeLease 仍是 operation-scoped 能力，不落库，也不参与 retire/collect。

### 3.2 Collect 统一通过 Celery

所有产品路径使用同一个 task：

```python
collect_agent_resources(
    tenant_id: str,
    binding_ids: list[str],
    workspace_ids: list[str],
    home_snapshot_ids: list[str],
)
```

task 的职责只有：

1. 依次调用现有 `collect_retired_workspace`、`collect_retired_binding` 和 `collect_retired_home_snapshot`。
2. 只处理参数中明确给出的 ID。
3. 不执行 retire，不推断产品 owner，不重新决定 Agent 是否应 archive。
4. 一个资源失败时记录日志并继续尝试其余资源。
5. 重复执行时依赖现有 collector 的 RETIRED 查询和幂等 backend delete 安全返回。

同一个产品动作只发送一个 task。task payload 不包含 backend ref、SQLAlchemy object 或产品 model。

collection 顺序为 Workspace、Binding、HomeSnapshot。Workspace collector 已负责选择一个 Binding 承载 Workspace 物理删除并继续清理剩余 Binding；后续显式 Binding collection 遇到已删除 row 时直接返回。

### 3.3 Enqueue 是 commit 后的 best effort

标准流程：

```text
product transaction
  -> mutate product rows
  -> retire lifecycle rows
  -> commit

after commit
  -> enqueue collect_agent_resources
  -> return product result
```

约束：

- commit 失败时不得 enqueue。
- enqueue 失败只记录 tenant 和逻辑资源 ID，不回滚已经提交的产品动作。
- 不使用 SQLAlchemy `after_commit`/`after_rollback` listener。
- 不在请求线程直接调用任何 `collect_*`。
- collection 失败不改变已经成功的 Apply、Delete、Archive 或 Workflow 终态。

未来 GC 可以扫描 RETIRED rows 并调用相同 collector，不创建第二套物理删除逻辑。

## 4. 删除即时创建补偿

### 4.1 Dify API 创建流程

HomeSnapshot、Workspace 和 Binding 的创建统一采用：

```text
validate product ownership and inputs
  -> create physical backend resource
  -> add ACTIVE ledger row
  -> flush/commit
```

Dify Agent 成功返回 backend ref 后，Dify API 不再在数据库异常路径同步调用 delete/destroy。

因此：

- backend create 失败：不写 ledger，直接返回原始创建错误；
- backend create 成功、后续 Python/flush/commit 失败：可能留下没有 ledger row 的物理 orphan；
- commit 结果不确定：不猜测数据库是否已经提交，也不执行破坏性补偿；
- orphan 最终由未来全局 reconciler 基于 backend inventory、数据库 ledger 和 grace period 判断并清理。

这是明确接受的最终一致性边界。即时补偿只覆盖“callback 注册后到 final flush 成功前”的狭小区间，不能处理进程崩溃、响应丢失、commit 不确定或补偿自身失败；既然全局 reconcile 无论如何都需要存在，不保留第二套不完整的清理机制。

### 4.2 保留 backend 内部的 partial-create cleanup

Dify Agent backend 在一次 create 尚未成功返回时，仍应清理自己创建到一半的资源：

- Local 创建目录或复制 Home 失败时删除本次 partial paths；
- E2B 创建 Sandbox 但初始化、清理 Workspace 或 pause 失败时 kill 该 Sandbox；
- initialize Home 使用的临时 E2B Sandbox 始终在 backend 内释放。

这类 cleanup 能确定 create 没有成功完成，不涉及数据库 commit 歧义，不属于本方案删除的跨系统补偿。

### 4.3 代码删除范围

删除：

- `api/services/agent/resource_creation_compensation.py`；
- `ResourceCreationCompensation`、`ResourceCreationCompensations`；
- `resource_creation_compensation`、`resource_creation_transaction`；
- `AgentWorkspaceService._compensate_binding`；
- `AgentHomeSnapshotService.compensate_creation`；
- Build Apply 中的 `compensations` 参数和 callback 注册；
- Dify API compensation-specific tests。

事务仍使用普通的 `session.begin()` 或显式 `session.commit()`/rollback，不引入新的 transaction wrapper。

## 5. 资源 Service 职责

### 5.1 AgentWorkspaceService

保留：

- `retire_binding(session, tenant_id, binding_id)`；
- `retire_workspace(session, tenant_id, workspace_id)`；
- `collect_retired_binding(tenant_id, binding_id)`；
- `collect_retired_workspace(tenant_id, workspace_id)`。

要求：

- 两个 retire 方法只修改 caller-owned transaction。
- 两个 collector 自己打开短数据库 session，在事务外调用 Dify Agent，成功后再用短事务删除 row。
- collector 捕获单个资源的 backend/DB 错误、记录结构化日志并保留 RETIRED row。
- 不把 collector 改成同时负责 retire。

为 App Delete 增加一个简单的批量数据库 helper：

```python
retire_all_for_app(
    session: Session,
    tenant_id: str,
    app_id: str,
) -> list[str]
```

它只查询并 retire 该 App 的 ACTIVE Workspaces，返回 workspace IDs，不 commit、不 collect。

### 5.2 AgentHomeSnapshotService

保留：

- `retire_all_for_agent(session, tenant_id, agent_id)`；
- `collect_retired_home_snapshot(tenant_id, home_snapshot_id)`。

`create_initial` 和 `create_for_build_apply` 只负责 backend create、构造 ledger model 并加入 session，不持有补偿 registry。

HomeSnapshot collection 继续检查 AgentConfigDraft/AgentConfigSnapshot 引用；有引用时保持 RETIRED，不执行物理删除。

### 5.3 WorkflowAgentRetirementService

删除 `schedule_after_commit` 以及 SQLAlchemy event listener。

保留纯数据库 ownership 判断，并提供显式同步入口：

```python
retire_unowned(
    tenant_id: str,
    agent_ids: Iterable[str],
    account_id: str | None,
) -> tuple[list[str], list[str]]
```

该方法使用 fresh session：

1. 重新查询 draft 和当前 published workflow ownership。
2. archive 确认无 owner 的 Workflow-only Agents。
3. retire 这些 Agent 的 ACTIVE Bindings 和 HomeSnapshots。
4. commit。
5. 返回 `binding_ids` 和 `home_snapshot_ids`。

它不 collect、不 enqueue。调用方在该 fresh transaction 成功后发送统一 collection task。

Workflow binding/config 的主事务必须先提交，再调用 `retire_unowned`。低层 binding projection/sync helper 不 commit，也不注册隐式 hook；它们把待复查的 Workflow-only Agent IDs 显式返回给最近的 application use-case owner。

## 6. 产品调用点

### 6.1 Build Apply

```text
checkpoint Materialized Home
  -> add new ACTIVE HomeSnapshot ledger
  -> update Normal Draft.home_snapshot_id
  -> retire Build Binding/Workspace
  -> delete Build Draft
  -> commit
  -> enqueue binding_id
```

改动：

- `apply_agent_app_build_draft` 用普通事务边界替换 `resource_creation_transaction`。
- `create_for_build_apply` 不再接收 compensation registry。
- 删除 commit 后同步 `collect_retired_binding`。
- commit 成功后发送统一 task。

### 6.2 Build Draft Discard

在删除 Build Draft 的同一事务 retire 对应 Build Workspaces，commit 后把 workspace IDs 发送给统一 task。删除同步 collection loop。

### 6.3 Conversation Delete

在删除 Conversation 的同一事务 retire Conversation Workspace，commit 后 enqueue workspace ID，再继续现有 conversation-related-data Celery 删除流程。

### 6.4 Debug Conversation 替换

保留当前独立短事务：

1. retire 被替换 conversation 的 Workspace；
2. commit；
3. enqueue workspace IDs。

方法名称和 docstring 不再包含 `collect`，也不在当前线程执行 backend I/O。

### 6.5 Roster Agent Archive

archive Agent、retire Bindings/HomeSnapshots 后一次 commit；commit 成功后把 binding IDs 和 snapshot IDs 放入同一个 collection task。

### 6.6 Agent App Delete

App 删除事务中同步完成：

- archive backing Agent；
- retire backing Agent Bindings/HomeSnapshots；
- `retire_all_for_app` retire 该 App 的全部 ACTIVE Workspaces；
- 删除 App；
- commit。

commit 后：

1. 同步调用 `WorkflowAgentRetirementService.retire_unowned` 复查该 App 的 Workflow-only Agents；
2. 合并返回的 Binding/HomeSnapshot IDs；
3. enqueue 一个 collection task。

`remove_app_and_related_data_task` 删除 `_retire_active_agent_workspaces_for_app`；后台 App data deletion 不再首次决定 Working Resource 的生命周期。

### 6.7 Workflow Run 终止

Graph terminal layer 不再 enqueue 一个“retire + collect”task。

改为：

1. terminal event 同步调用 `WorkflowAgentWorkspaceStore.retire_workflow_run`；
2. store 使用 fresh session retire 该 run 的 Workspaces 并 commit；
3. store 返回 workspace IDs，不执行 collect；
4. terminal layer enqueue 统一 collection task。

terminal event 重复到达时，retire 查询可以同时返回该 run 已经 RETIRED 的 Workspace IDs，重复 collection 仍保持幂等。

retire DB 失败只记录错误，不覆盖已经确定的 Workflow terminal result；未来全局 reconciler 根据已结束 Workflow Run 与仍 ACTIVE 的 lifecycle rows 修复。

### 6.8 Workflow-only Agent 失去 owner

当前所有 `schedule_after_commit` 调用点改成显式候选传递：

```text
workflow binding/config transaction
  -> collect candidate agent IDs
  -> commit

fresh retirement transaction
  -> re-check ownership
  -> archive unowned Agents
  -> retire Bindings/HomeSnapshots
  -> commit

enqueue collection
```

低层方法使用 `set[str]` 返回候选，不新增 retirement-plan model、session.info 状态或 ORM hook。

主产品事务已提交后，fresh retirement transaction 失败不得尝试回滚主产品动作；记录 tenant/candidate IDs，留给未来 reconciler。

## 7. Celery Task 与文件组织

新增：

- `api/tasks/collect_agent_resources_task.py`

包含：

- `collect_agent_resources` Celery task；
- 一个小型 `enqueue_agent_resource_collection` helper，统一完成空列表短路、ID 去重、`.delay()` 和 enqueue failure 日志。

helper 只接受：

```python
tenant_id: str
binding_ids: Iterable[str] = ()
workspace_ids: Iterable[str] = ()
home_snapshot_ids: Iterable[str] = ()
```

没有资源 ID 时不发送 task。输入在发送前转换为排序后的唯一字符串列表，使测试和日志稳定。

删除或收敛：

- 删除 `retire_workflow_agent_workspaces` Celery task；
- 删除 `retire_workflow_agents_if_unowned` Celery task；
- `retire_workflow_agents_task.py` 不再保留其他用途时整体删除；
- 所有产品 service 的同步 `collect_*` loop；
- `WorkflowAgentRetirementService.schedule_after_commit`。

新 task 使用现有默认 Celery 路由，不新增 queue、worker 或 compose 配置。

## 8. 事务与失败语义

| 失败点 | 行为 |
| --- | --- |
| backend create 尚未成功返回 | backend 内部清理 partial resource；Dify API 不写 ledger |
| backend create 成功，DB/Python 后续失败 | 不即时补偿；可能形成 orphan，未来全局 reconcile |
| DB commit 结果不确定 | 不删除外部资源；未来 reconcile 判断 |
| retire transaction 失败 | 不 enqueue collection；产品事务按其原有语义失败或记录 |
| post-commit Workflow-only retirement 失败 | 主产品动作保持成功；记录候选，未来 reconcile |
| collection enqueue 失败 | RETIRED rows 保留；记录逻辑 IDs |
| collection backend delete 失败 | RETIRED row/ref 保留 |
| collection 成功、最终 ledger delete 失败 | backend delete 幂等；row 保留供下次 collection |
| Celery task 重复执行 | collector 查询不到 RETIRED row 或 backend already-not-found，安全返回 |

不允许：

- retire 失败后在 Celery 中首次重放产品状态转换；
- backend 失败后切换 Local/E2B/Enterprise；
- collect 时根据 owner 猜测额外资源；
- enqueue 失败时回滚已经提交的 retire；
- 在异常类型上推断 commit 是否已经生效；
- 为本轮增加 fallback 或兼容分支。

## 9. 数据库与基础设施

本方案不修改数据库 schema。

继续使用：

- `status=ACTIVE|RETIRED`；
- `retired_at`；
- Workspace/Binding 的 `active_guard`；
- ledger 中已有的 backend refs。

RETIRED rows 是未来 GC 的输入。数据库中不存在 ledger row 的 create orphan 由未来全局 reconciler 从 backend inventory 侧发现；该 reconciler 必须使用 grace period 避开仍可能处于 commit 不确定窗口的资源。

当前 E2B 创建 Binding 和 initial Home Snapshot 时已经写入 Dify logical ID metadata；Local ref/path 由逻辑 ID 推导。本方案不提前实现 inventory API、扫描器或额外 metadata schema。

## 10. 代码实现步骤

### Step 1：建立统一异步 collection 入口

1. 新增 `collect_agent_resources_task.py`。
2. 实现 task 和 enqueue helper。
3. 为去重、空输入、多个资源继续执行、enqueue failure 日志增加单元测试。

### Step 2：切换已有同步 collection 调用点

依次修改：

- `api/services/agent/composer_service.py`
- `api/services/conversation_service.py`
- `api/services/agent/roster_service.py`
- `api/services/app_service.py`

每个调用点验证顺序为 retire → commit → enqueue，并删除请求线程中的 backend collection。

### Step 3：同步 Workflow Run retirement

1. 让 `WorkflowAgentWorkspaceStore.retire_workflow_run` 返回 workspace IDs。
2. 删除 store 内同步 collection。
3. terminal layer 直接调用 store retire，然后 enqueue collection。
4. 删除 `retire_workflow_agent_workspaces` task。

### Step 4：同步 Workflow-only Agent retirement

1. 删除 `schedule_after_commit` listener。
2. 让低层 workflow binding helper 显式返回 candidate Agent IDs。
3. 在最近的 application use-case commit 后调用 fresh-session `retire_unowned`。
4. retire transaction 成功后 enqueue collection。
5. 删除 `retire_workflow_agents_if_unowned` task。

涉及：

- `api/services/agent/composer_service.py`
- `api/services/agent/dsl_service.py`
- `api/services/agent/workflow_publish_service.py`
- `api/services/workflow_service.py`
- `api/services/snippet_service.py`
- `api/services/app_service.py`

### Step 5：把 App Workspace retirement 移入产品事务

1. 实现 `AgentWorkspaceService.retire_all_for_app`。
2. `AppService.delete_app` 在删除 App 前调用。
3. commit 后 enqueue。
4. 从 `remove_app_and_related_data_task.py` 删除首次 retire/collect 逻辑。

### Step 6：删除即时创建补偿

1. 用普通事务替换 `resource_creation_transaction`。
2. 删除 compensation module、callback 和参数传递。
3. 保留 Dify Agent backend 内部 partial-create cleanup。
4. 更新 HomeSnapshot、Workspace 和 Build Apply tests。

### Step 7：文档与回归验证

更新 Dify Agent runtime-resource 文档：

- retire 同步、collect 异步；
- Dify API 不执行即时创建补偿；
- backend 内部 partial cleanup 与未来全局 reconcile 的边界；
- 当前不实现 TTL、GC/reconciler。

运行相关 API、Dify Agent、migration、类型和 lint 测试。

## 11. 测试方案

### 11.1 Collection task

- 空 ID 不 enqueue；
- task payload 去重且稳定排序；
- Workspace、Binding、HomeSnapshot 按顺序调用对应 collector；
- 一个 collector 失败不阻止其余 ID；
- 重复执行不报错；
- enqueue failure 只记录日志。

### 11.2 产品生命周期

对 Build Apply、Build Discard、Conversation Delete、Debug Conversation 替换、Roster Archive、App Delete 验证：

- retire 在 commit 前；
- `.delay()` 在 commit 成功后；
- commit 失败不 enqueue；
- 当前线程不调用 Dify Agent destroy/delete；
- task payload 只包含 tenant 和逻辑 row IDs。

### 11.3 Workflow

- Workflow terminal event 同步 retire Workspace；
- terminal path 不再发送 retirement task；
- retire 成功后发送 collection task；
- Workflow-only candidate 只在主事务 commit 后复查；
- ownership 仍存在时不 archive；
- ownership 消失时同步 archive/retire，然后 enqueue；
- 不再注册 SQLAlchemy transaction listeners。

### 11.4 创建失败

- Dify API backend create 成功后，flush/commit/Python 失败均不调用 delete/destroy；
- create 原始异常保持不变；
- 不再存在 compensation registry 测试；
- Local/E2B backend create 自身失败时仍清理 partial resource。

### 11.5 Collection ledger

- collect 只处理 RETIRED row；
- backend delete 失败保留 row/ref；
- backend delete 成功后删除 row；
- Workspace collection 继续清理剩余 Binding；
- HomeSnapshot 有 Config 引用时保持 RETIRED。

## 12. 验收标准

1. 所有明确产品生命周期事件同步提交 retire。
2. Dify API 请求线程和 Workflow terminal path 不直接执行 physical collection。
3. 只有统一 Celery task 调用三个 `collect_*`。
4. 不存在首次 retire 的 Celery task。
5. 不存在 SQLAlchemy `after_commit`/`after_rollback` retirement listener。
6. App row 删除前，其全部 ACTIVE Workspaces 已在同一事务 retire。
7. Dify API 不再包含 creation compensation module、callback 或测试。
8. backend-local partial-create cleanup 保持有效。
9. 没有新增数据库状态、表、migration、Celery queue、fallback 或兼容代码。
10. collection/enqueue 失败不会改变已提交的产品结果，RETIRED rows 保留为未来 GC 输入。
