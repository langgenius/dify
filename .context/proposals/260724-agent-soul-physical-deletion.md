# Agent Soul 物理删除方案

## 1. 结论

Agent 不再使用 `ACTIVE / ARCHIVED` 软删除状态。数据库中存在 `agents` 行就表示该 Agent Soul 可用；删除 Agent 就物理删除该行及其 Soul-owned 数据。

删除动作按资源性质分为两类：

1. 纯数据库数据在删除事务内直接删除；
2. 具有 Local/E2B 等外部物理资源的 Home Snapshot、Agent Workspace Binding 和 Workspace，在删除事务内同步 `retire`，commit 后通过现有 `retention` 队列异步 `collect`。

状态模型因此收敛为：

```text
Agent Soul:
EXISTS -> row deleted

Working Environment resource:
ACTIVE -> RETIRED -> physical resource deleted + ledger row deleted
```

不为 Agent 增加 `DELETING`、`DELETED`、tombstone 或删除审计表，也不保留 `ARCHIVED` 兼容语义。

按本阶段产品约束，Agent 删除与正在执行的 request/Runtime Lease 之间的竞争不处理：不等待运行结束、不取消 request、不做 lease 引用计数，也不阻止 collector 回收资源。

## 2. 背景与问题

当前 `Agent.status` 只有：

- `active`
- `archived`

产品的“删除 Agent”实际执行的是：

1. 把 Agent 标记为 `ARCHIVED`；
2. retire Binding、Home Snapshot 和 App Workspace；
3. 删除 App；
4. 异步删除 App 相关数据。

但当前产品没有：

- Agent archive 列表；
- unarchive/restore Agent API；
- 从 `ARCHIVED` 恢复 Agent Soul 的 UI；
- 依赖 archived Agent 继续运行的产品路径。

版本 restore 与 Agent archive 无关。版本 restore 只是在一个仍然存在的 Agent Soul 内，把历史 `AgentConfigSnapshot` 的内容复制回当前 Draft。

因此 `ARCHIVED` 只是不可恢复的内部 tombstone。它带来以下额外复杂度：

- 所有查询和 validator 都要重复过滤 `AgentStatus.ACTIVE`；
- runtime 需要区分“Agent 不存在”和“Agent 已 archived”，但两者对调用方都不可用；
- roster 名称唯一性依赖 generated column 中的 status 条件；
- Agent 配置、revision、debug conversation、Drive 和 workflow binding 仍残留；
- Home Snapshot collector 会被仍然存在的 Draft/Snapshot 引用阻挡；
- workflow-only Agent retirement 实际只隐藏 Agent，没有完成所有权终止后的数据清理；
- API 和生成的前端 contract 暴露了没有产品用途的 status/archive 字段。

物理删除可以把这些语义统一为“存在即有效，不存在即已删除”。

## 3. 目标

- Agent 删除成为不可恢复的物理删除。
- 删除 Agent Soul 时清理全部 Soul-owned 数据。
- retire 与该 Soul 关联的全部 ACTIVE Bindings 和 Home Snapshots。
- 只在最后一个 ACTIVE Binding 退出时 retire 对应 Workspace，不误删其他 participant 仍在使用的共享 Workspace。
- 删除 workflow 对该 Soul 的规范化关联，避免保留指向已删除 Agent/config 的活动引用。
- 删除 workflow-only Agent 独占的隐藏 backing App，并复用现有 App 数据清理任务。
- 删除 `AgentStatus`、archive 字段、archive-specific 查询和错误。
- 保持 Dify API 是持久资源生命周期账本，Dify Agent 不增加数据库或产品状态。
- 复用现有 `retire -> retention queue -> collect` 机制。
- 保持实现直接、显式、fail fast，不增加兼容层或 fallback。

## 4. 非目标

本方案不实现：

- Agent 回收站、恢复、保留期或删除审计；
- Agent `DELETING`、`DELETED`、`FAILED` 等状态；
- 正在运行 request 与删除/collector 的并发协调；
- Runtime Lease 持久化、引用计数、writer lock 或 cancel protocol；
- 删除前等待 E2B Sandbox idle；
- 因 workflow 引用而阻止 Agent 删除；
- 自动迁移或重写 workflow graph JSON；
- 保留已删除 Agent 的版本 restore 能力；
- 可靠投递 outbox、删除任务表或新的 Celery queue；
- 新的 Working Environment collector 或 backend protocol；
- 旧 `ARCHIVED` 数据、旧 API contract 或旧查询的兼容逻辑；
- Enterprise backend 的新增实现。

## 5. 术语与所有权

### 5.1 Agent Soul

Agent Soul 是：

- `Agent` 身份；
- 可编辑 Config Draft；
- 不可变 Config Snapshot；
- Config Revision 历史；
- Agent Drive；
- Agent-owned Home Snapshot lineage。

删除 Soul 表示这些产品数据不再保留，也不再支持版本 restore。

### 5.2 Participant

`AgentWorkspaceBinding.id` 是 materialized Agent participant 的身份。它拥有：

- Materialized Home；
- Agenton session snapshot；
- pending form/tool call state；
- backend binding ref。

Participant 是有物理资源的账本实体，不能在删除 Agent 的数据库事务中直接删行。它必须先 `RETIRED`，由 collector 完成物理回收后再删除账本行。

### 5.3 Workspace

Workspace 由 conversation、build draft 或 workflow run 等产品上下文拥有，不由 Agent Soul 独占。

删除一个 Agent 时：

- retire 该 Soul 的全部 ACTIVE Bindings；
- 若 Workspace 仍有其他 ACTIVE Bindings，保留 Workspace；
- 若被删除 Binding 是最后一个 ACTIVE Binding，按现有规则 retire Workspace；
- 删除 Agent App 时，继续 retire 该 App 拥有的全部 Workspace。

因此“删除 Soul”不等于“无条件删除所有关联 Workspace”。

### 5.4 Home Snapshot

Home Snapshot 是 Agent-owned 的不可变外部资源。删除 Agent 时将其全部 ACTIVE 行标记为 `RETIRED`。

同一事务内会删除该 Agent 的 `AgentConfigDraft` 和 `AgentConfigSnapshot`，所以事务提交后 Snapshot collector 的配置引用检查不会再阻止这些 Snapshot 被回收。

### 5.5 Runtime Lease

Runtime Lease 仍是一次操作的进程内能力对象，不落库、不参与删除事务。

Agent 删除不会：

- 查询当前 lease；
- 等待 lease release；
- 向运行中 request 发 cancel；
- 为 collector 增加 busy check。

## 6. 删除矩阵

| 资源 | 逻辑所有者 | Agent 删除动作 | 原因 |
|---|---|---|---|
| `agents` | Agent Soul | 事务内物理删除 | Soul identity 本身 |
| `agent_config_drafts` | Agent Soul | 事务内物理删除 | 无独立生命周期 |
| `agent_config_snapshots` | Agent Soul | 事务内物理删除 | 不再保留版本 restore |
| `agent_config_revisions` | Agent Soul | 事务内物理删除 | 不保留已删除 Soul 的审计历史 |
| `agent_debug_conversations` | Agent Soul / editor mapping | 事务内物理删除 | 避免保留 dangling Agent mapping |
| `agent_drive_files` | Agent Soul | 事务内物理删除 | Drive 随 Soul 消失 |
| Drive-owned `UploadFile` / `ToolFile` row | Agent Drive value | 事务内物理删除 | 仅 `value_owned_by_drive=true` 且无其他 Drive 引用时删除 |
| Drive-owned storage object | Agent Drive value | commit 后 best effort 删除 | 外部存储不能与数据库事务原子提交 |
| 非 Drive-owned file value | 其他业务对象 | 只删除 `agent_drive_files` 引用 | Agent 不拥有底层文件 |
| `workflow_agent_node_bindings` by `agent_id` | Workflow 与 Agent 的关联 | 事务内物理删除 | 不保留指向已删除 Soul/config 的规范化关联 |
| `agent_workspace_bindings` | Participant | 同步 retire，异步 collect | 拥有 Materialized Home/后端资源 |
| `agent_home_snapshots` | Agent Soul | 同步 retire，异步 collect | 拥有外部 Snapshot |
| `agent_workspaces` | Product owner scope | last-active 或 App delete 时 retire | Workspace 可能由其他 participant 共享 |
| workflow-only hidden backing `apps` row | Workflow-only Agent | 事务内物理删除 | 该隐藏 App 由该 Soul 独占 |
| hidden backing App 相关业务数据 | Hidden App | commit 后复用 App deletion task | 已有异步批量清理机制 |
| Agent App 的公开 `apps` row | Agent App 产品实体 | 由 `AppService.delete_app` 同事务删除 | App 与 backing roster Agent 共同构成当前产品实体 |
| Agent App conversations/messages | App | 复用现有 App deletion task | 属于 App，不属于独立 Soul 子表 |
| workflow graph JSON | Workflow | 保留 | 不扫描/重写用户 workflow artifact |
| workflow run/node execution 历史 | Workflow run | 保留 | 历史 row 可保留已失效的逻辑 ID |
| Runtime Lease | 当前 operation | 不做生命周期动作 | 不持久化 |

## 7. 数据模型调整

### 7.1 删除 Agent 软删除字段

从 `Agent` model 和 `agents` 表删除：

```text
status
archived_by
archived_at
```

同时删除：

- `AgentStatus` enum；
- `models.__init__` 中的 `AgentStatus` export；
- `AgentArchivedError`；
- 所有 `status=ACTIVE` 创建参数；
- 所有 `status == ACTIVE`、`status != ACTIVE` 和 `status == ARCHIVED` 条件；
- archive timestamp/actor 的序列化与测试。

删除后不增加替代字段。Agent 可用性只通过 tenant-scoped 主键查询判断。

### 7.2 Roster 名称唯一性

`roster_unique_name` 改为：

```sql
CASE WHEN scope = 'roster' THEN name ELSE NULL END
```

`(tenant_id, roster_unique_name)` 唯一约束继续保留。

效果：

- 存在的 roster Agent 名称仍然唯一；
- Agent 行物理删除后名称自然释放；
- workflow-only Agent 不参与 roster 名称唯一性；
- 不再依赖 status 模拟“释放名称”。

### 7.3 Invitable 查询索引

`agent_tenant_invitable_idx` 从：

```text
(tenant_id, scope, status, active_config_has_model, updated_at)
```

改为：

```text
(tenant_id, scope, active_config_has_model, updated_at)
```

其他 Agent index 保持不变。

### 7.4 关联仍不增加数据库外键

本方案不为以下逻辑引用新增 foreign key 或 cascade：

- Config row -> Agent；
- WorkflowAgentNodeBinding -> Agent/ConfigSnapshot；
- HomeSnapshot -> Agent；
- WorkspaceBinding -> Agent/HomeSnapshot/Workspace；
- Conversation/Draft/WorkflowNodeExecution -> WorkspaceBinding。

原因是：

- Working Environment 的 RETIRED ledger row 必须能短暂晚于 Agent/Workspace/Snapshot 产品记录存在；
- caller pointer 可以作为历史 identity 晚于 Binding ledger row；
- 外部物理删除成功后 collector 要独立删除 ledger row；
- 删除顺序需要由 application service 显式表达，而不是交给数据库 cascade 隐式决定。

纯数据库 Soul-owned 行使用显式 bulk delete；Working Environment 行使用显式 retire。

### 7.5 Migration 策略

当前 Agent schema 仍处于本分支的中间实现阶段，不建立旧 `ARCHIVED` schema 的兼容边界。

实现时直接修改拥有这些字段和 index 的现有 migration：

- Agent domain migration 不再创建 status/archive 字段；
- `roster_unique_name` 使用最终表达式；
- invitable index migration 不再包含 status；
- 对应 migration tests 直接更新为最终 schema。

不新增：

- archived row backfill；
- archived-to-deleted 数据转换；
- dual schema；
- follow-up compatibility migration；
- compatibility tests。

本地验证使用新的数据库。

## 8. Service 设计

### 8.1 `AgentDeletionService`

新增一个 Dify API 内部应用服务，集中表达 Soul 删除，不让 App、Workflow、Snippet 各自复制删除顺序。

接口：

```python
AgentDeletionService.delete_soul(
    *,
    session: Session,
    tenant_id: str,
    agent_id: str,
) -> AgentDeletionResult | None
```

`AgentDeletionResult` 只携带 commit 后需要处理的最小信息：

```python
AgentDeletionResult:
    binding_ids: list[str]
    workspace_ids: list[str]
    home_snapshot_ids: list[str]
    hidden_backing_app_id: str | None
    drive_storage_keys: list[str]
```

service 的职责：

1. tenant-scoped 加载并锁定 Agent；
2. retire 该 Agent 的全部 ACTIVE Bindings，并记录因此新进入 RETIRED 的 Workspace；
3. retire 该 Agent 的全部 ACTIVE Home Snapshots；
4. 删除 Drive manifest，并按现有 ownership 规则删除 Drive-owned file records；
5. 删除 AgentDebugConversation；
6. 删除引用该 Agent 的 WorkflowAgentNodeBinding；
7. 删除 ConfigRevision、ConfigDraft 和 ConfigSnapshot；
8. 对 workflow-only Agent 删除其独占 hidden backing App row；
9. 删除 Agent row；
10. 返回 commit 后 cleanup 所需 ID/key。

service 不：

- commit 或 rollback caller session；
- 调用 Dify Agent；
- 直接 collect Working Environment；
- 发送 Celery task；
- 在事务内删除 storage object；
- 删除 workflow-only Agent 的 parent workflow/snippet App；
- 删除 roster Agent 对应的公开 Agent App。

Agent row 不存在时 service 返回 `None`。用户 delete endpoint 把 `None` 映射为 `AgentNotFoundError`；workflow orphan cleanup 则跳过已经不存在的内部 candidate。这样不需要 `missing_ok` 参数或两套删除实现。

同一模块提供一个无数据库事务职责的 commit 后 helper：

```python
dispatch_agent_deletion_cleanup(
    *,
    tenant_id: str,
    results: Iterable[AgentDeletionResult],
    additional_workspace_ids: Iterable[str] = (),
) -> None
```

它只负责对 logical IDs/storage keys 去重，然后：

- 调用 `enqueue_agent_resource_collection`；
- 为 `hidden_backing_app_id` 发送既有 App deletion task；
- best effort 删除 Drive storage objects。

调用方必须在确认自己的 commit 成功后显式调用它。helper 不注册 ORM event，不查询产品 ownership，也不执行 retire。

### 8.2 `AgentWorkspaceService`

新增一个 lifecycle-only 批量接口：

```python
retire_all_for_agent(
    *,
    session: Session,
    tenant_id: str,
    agent_id: str,
) -> tuple[list[str], list[str]]
```

返回：

```text
(retired_binding_ids, newly_retired_workspace_ids)
```

规则：

- 查询该 Agent 的全部 ACTIVE Bindings；
- 对每个准确 Binding 调用现有 retire 逻辑；
- retire 一个 Binding 不影响同 Soul 的其他 participant；
- Workspace 仍有其他 ACTIVE Binding 时不 retire；
- 最后一个 ACTIVE Binding 退出时把 Workspace ID 返回给 collector；
- 不 commit、不 enqueue、不 collect。

`retire_all_for_app` 继续用于 Agent App 删除，retire 该 App 拥有的所有 Workspace。

### 8.3 `AgentHomeSnapshotService`

继续使用：

```python
retire_all_for_agent(
    session,
    tenant_id,
    agent_id,
) -> list[str]
```

collector 的 ConfigDraft/ConfigSnapshot 引用检查保留。正常 Agent 删除事务会先删除这些引用；如果未来其他错误路径错误地 retire 仍被有效配置引用的 Snapshot，collector 仍应拒绝物理删除。

### 8.4 `AgentDriveService`

把现有单 key/prefix 删除使用的内部清理逻辑抽成 caller-transaction-aware 方法：

```python
remove_all_for_agent(
    *,
    session: Session,
    tenant_id: str,
    agent_id: str,
) -> list[str]
```

该方法：

- 不要求 commit；
- 删除全部 `AgentDriveFile` rows；
- 只对 `value_owned_by_drive=true` 的 value 尝试删除 backing UploadFile/ToolFile row；
- backing value 仍被其他 Drive row 引用时保留；
- 返回 commit 后可以删除的 storage keys；
- 不直接删除 storage object。

caller commit 成功后，复用一个公开的 best-effort storage cleanup helper 删除这些 keys。commit 失败时不删除 storage object。

不增加 Drive lifecycle 表、storage deletion task 或 outbox。storage 删除失败按现有 Drive 语义记录日志，未来由全局 orphan reconciler 处理。

### 8.5 `WorkflowAgentDeletionService`

把 `WorkflowAgentRetirementService` 重命名并收敛为：

```python
WorkflowAgentDeletionService.delete_unowned(
    *,
    tenant_id: str,
    agent_ids: Iterable[str],
) -> None
```

它负责：

1. 对候选 workflow-only Agent 重新检查当前 draft/published workflow 的有效所有权；
2. 对确认无 owner 的 Agent 调用 `AgentDeletionService.delete_soul`；
3. 在 fresh session 中 commit；
4. commit 成功后统一 enqueue Working Environment collection；
5. enqueue hidden backing App 的既有 App cleanup task；
6. best effort 删除 Drive storage objects。

删除 `account_id` 参数，因为物理删除不再记录 archived actor。

这个 service 在产品主事务提交后运行。其失败不能回滚已经提交的 workflow/snippet/App 变更；失败时记录候选 Agent IDs，遗留 orphan 交给未来全局 reconciler。本方案不为此新增状态或可靠任务表。

删除：

- `archive_unowned`；
- archived Agent 重试分支；
- ACTIVE/ARCHIVED candidate 查询；
- `archived_by`、`archived_at` 更新；
- 调用方对 binding/snapshot IDs 的手工 enqueue。

## 9. 事务与外部资源关系

### 9.1 数据库事务

标准删除事务：

```text
lock Agent
  -> retire Bindings / last-active Workspaces
  -> retire Home Snapshots
  -> delete Soul-owned database rows
  -> delete Agent row
  -> delete owned App row when applicable
  -> commit
```

在 commit 之前不执行不可回滚的外部删除。

### 9.2 Commit 后处理

commit 成功后：

```text
enqueue collect_agent_resources to retention
  -> Workspace collector
  -> Binding collector
  -> Home Snapshot collector

enqueue existing App deletion task for deleted App IDs

best effort delete Drive-owned storage objects
```

规则：

- commit 失败：不 enqueue、不删除 storage object；
- enqueue 失败：已提交的 Agent 删除不回滚，RETIRED ledger row 保留；
- collector 失败：RETIRED ledger row 保留；
- storage delete 失败：记录日志，不恢复已删除数据库 row；
- App cleanup task 失败：沿用现有 App deletion task retry；
- Agent delete endpoint 在主数据库事务提交后即可返回，不等待物理 collection。

### 9.3 不引入跨系统补偿

本方案不尝试在 commit 失败时“恢复”已经 retire 的 ORM 对象，也不在外部 cleanup 失败时重建 Agent。

数据库 rollback 自然恢复同一事务内的数据库变更；外部物理删除只在 commit 后发生。跨系统 orphan 由既有 RETIRED ledger 与未来 global reconciler 处理。

## 10. 产品流程

### 10.1 删除 Agent App

现有：

```http
DELETE /console/api/agent/{agent_id}
```

route 保持不变，语义改为不可恢复的物理删除：

1. 根据 `agent_id`、tenant 和 App ownership 解析 Agent App；
2. 捕获该 App 当前关联的 workflow-only Agent candidate IDs；
3. 对 backing roster Agent 调用 `AgentDeletionService.delete_soul`；
4. retire 该 App 的全部 ACTIVE Workspaces；
5. 删除公开 App row；
6. commit；
7. enqueue 合并后的 Workspace/Binding/HomeSnapshot collection；
8. 调用既有 App related-data deletion task；
9. 调用 `WorkflowAgentDeletionService.delete_unowned` 复查并删除已失去 owner 的 workflow-only Agents；
10. 返回 `204`。

同一个 Workspace ID 或 Binding ID 在结果中去重后再 enqueue。

删除完成后：

- Agent detail/list 不再返回该 Agent；
- 再次通过该 Agent ID 调用返回 404；
- App conversations/messages 等继续由现有异步任务删除；
- 不存在 unarchive/restore Agent 操作。

### 10.2 Workflow draft/publish/restore 变更

所有当前会产生 workflow-only Agent retirement candidates 的调用点改为调用：

```python
WorkflowAgentDeletionService.delete_unowned(...)
```

包括：

- workflow Agent binding 同步；
- draft 替换或 node 删除；
- workflow restore；
- DSL import；
- snippet workflow 变更；
- App 删除后的 workflow-only ownership 复查。

有效所有权仍按当前规则定义：

- normal App；
- 当前 draft workflow；
- App 当前 published workflow。

仍有任一有效 owner 时不删除 Agent。确认无 owner 时物理删除 Soul 及其 hidden backing App。

### 10.3 删除 Snippet/App

Snippet 删除中现有的“批量把 owned Agents 标为 ARCHIVED”改为调用统一 `AgentDeletionService`。

`SnippetService.delete_snippet` 不拥有 commit，因此改为返回：

```python
list[AgentDeletionResult]
```

commit-owning controller 在 `session.commit()` 成功后 dispatch 这些结果。删除现有 SQLAlchemy `after_commit` listener，不把外部 cleanup 隐藏在 ORM event 中。

要求：

- 不重复手写 Config、Drive、Binding、Snapshot 删除逻辑；
- 不删除 snippet/workflow parent App 作为 Agent hidden backing App；
- 只删除每个 workflow-only Agent 独占的 `backing_app_id`；
- commit 后统一 dispatch collection 和 hidden App cleanup。

### 10.4 删除仍被 Workflow 引用的 Roster Agent

删除操作不因 `published_reference_count` 或 WorkflowAgentNodeBinding 引用而被阻止。

删除事务会删除所有 `WorkflowAgentNodeBinding.agent_id == target_agent_id` 的规范化关联。Workflow graph JSON 和历史 workflow rows 不重写。

之后：

- draft/publish validation 会报告 Agent binding 缺失；
- runtime resolver 会报告 Agent/binding 不可用；
- 不自动选择同名 Agent；
- 不自动恢复历史 Agent ConfigSnapshot；
- 不隐式创建替代 Agent。

这是物理删除的明确结果，不增加引用保护或 fallback。

### 10.5 Agent 版本 restore

版本 restore 只适用于仍存在的 Agent。

Agent 已删除时：

- ConfigSnapshot 和 ConfigRevision 已不存在；
- restore endpoint 返回 Agent not found；
- 不从 workflow binding、日志或 Drive 重建 Soul。

保留现有 active Agent 内部的版本 restore 功能。

## 11. 并发语义

### 11.1 明确忽略 request/delete 竞争

本方案接受以下竞争：

```text
request resolves Agent/Binding
        |
        +---- concurrent Agent delete commits
        |
        +---- collector may destroy backend resource
```

运行中 request 可能表现为：

- 后续保存 session snapshot 时发现 Binding 已非 ACTIVE；
- shellctl/E2B 操作因资源被销毁而失败；
- resume 时找不到 Agent、Binding 或 Config；
- request 已在 collector 前完成并返回。

本阶段不保证其中某一种固定结果。

不增加：

- delete-vs-run lock；
- lease drain；
- cancel broadcast；
- deletion grace period；
- collector busy retry；
- request generation token；
- 并发竞争专项测试。

### 11.2 数据库内并发

`AgentDeletionService` tenant-scoped 锁定 Agent row，避免两个数据库删除事务重复处理同一个 Soul。

这把锁只用于保持数据库删除顺序，不扩展为 runtime 生命周期锁。后到达的用户 delete 请求在 Agent 行已不存在时返回 404。

## 12. Query、API 与错误语义调整

### 12.1 Query

所有 Agent 使用路径改为：

```text
tenant_id + agent_id/scope/source/ownership
```

不再附加 status 条件。

需要覆盖的主要模块：

- Agent roster list/detail/invite/update；
- Agent composer；
- Agent DSL import/export；
- workflow Agent publish/sync；
- Agent App list/backing Agent lookup；
- App `bound_agent_id`；
- workflow Agent binding resolver/validator；
- Agent App parameters；
- Home Snapshot ownership validation；
- snippet/workflow-only Agent ownership 查询。

“Agent 不存在”就是唯一不可用判断。Home Snapshot、Workspace 和 Binding 仍继续检查自己的 ACTIVE/RETIRED 状态。

### 12.2 API schema

从 Agent response DTO 删除：

```text
status
archived_by
archived_at
```

至少包括：

- `AgentRosterResponse`；
- `AgentComposerAgentResponse`；
- 复用这些 response 的 Agent、Apps、Snippets OpenAPI surfaces。

使用仓库既有 contract generation 命令重新生成：

- `packages/contracts/generated/api/console/agent/*`；
- `packages/contracts/generated/api/console/apps/*`；
- `packages/contracts/generated/api/console/snippets/*`。

不手工编辑 generated files。

前端当前没有 Agent archive/restore 交互，只需更新受类型变化影响的 fixtures 和请求 mock，不新增 UI 状态。

### 12.3 错误

删除：

- `AgentArchivedError`；
- “Archived agent cannot be modified” 分支；
- runtime/validator 对 archived Agent 的特殊判断。

保留：

- Agent 不存在：404 或现有 domain-specific `agent_not_available`；
- ConfigSnapshot 不存在：现有 version/config error；
- Binding/HomeSnapshot 非 ACTIVE：现有 working-resource error。

## 13. 代码分层

### 13.1 Dify API

| 文件/模块 | 目标职责 |
|---|---|
| `api/models/agent.py` | 删除 Agent soft-delete schema；保留 Working Environment status |
| `api/services/agent/deletion_service.py` | 单个 Soul 的事务内删除编排与 cleanup result |
| `api/services/agent/workspace_service.py` | 按 Agent 批量 retire Binding，并返回新 retire Workspace |
| `api/services/agent/home_snapshot_service.py` | 按 Agent retire Snapshot，collector 逻辑不变 |
| `api/services/agent_drive_service.py` | caller transaction 内删除完整 Drive manifest 并返回 storage keys |
| `api/services/agent/retirement_service.py` | 重命名为 workflow-only ownership recheck + physical deletion |
| `api/services/app_service.py` | Agent App/App/Workspace 删除事务和 commit 后 dispatch |
| `api/services/snippet_service.py` | 使用统一 deletion service，不再手写 archive |
| `api/tasks/collect_agent_resources_task.py` | 继续在 `retention` 队列 collect Working Environment |
| `api/tasks/remove_app_and_related_data_task.py` | 继续清理公开/隐藏 App 的关联业务数据 |

`AgentDeletionService` 是数据库 transaction participant；product service 仍然拥有 transaction boundary。

### 13.2 Dify Agent 与 backend

不修改：

- Dify Agent private routes；
- `ExecutionBindingBackend`；
- `HomeSnapshotBackend`；
- Runtime Lease；
- Local backend；
- E2B backend；
- Enterprise backend；
- shellctl；
- backend ref schema。

物理资源删除继续由现有 collector 调用 Dify Agent：

```text
Dify API retention worker
  -> Dify Agent destroy/delete API
  -> current Local or E2B backend
```

Agent Soul 的物理删除是 Dify API 产品控制面的概念，不下沉为 Dify Agent 的新实体。

## 14. 实现步骤

### Step 1：收敛 Agent schema

1. 从 model 删除 `AgentStatus`、`status`、`archived_by`、`archived_at`。
2. 修改 `roster_unique_name` generated expression。
3. 修改 invitable index。
4. 更新现有 owning migrations 和 migration tests。
5. 删除 model export 和 archive-specific error。

Gate：

- `agents` 最终 schema 中没有任何软删除字段；
- roster 名称约束只依赖 scope；
- Working Environment 的 `AgentWorkingResourceStatus` 不受影响。

### Step 2：实现统一 Soul 删除

1. 新增 `AgentDeletionService` 和最小 `AgentDeletionResult`。
2. 增加 `AgentWorkspaceService.retire_all_for_agent`。
3. 增加 `AgentDriveService.remove_all_for_agent`。
4. 显式删除 Config、Revision、DebugConversation、Drive 和 WorkflowAgentNodeBinding。
5. 删除 workflow-only hidden backing App row，但保留 parent App。
6. 确保 service 不 commit、不 enqueue、不调用 backend。

Gate：

- Soul-owned 数据库行在 caller transaction 内全部删除；
- Binding/Snapshot/Workspace 只 retire；
- shared Workspace 中其他 participant 不受影响；
- commit 前没有外部破坏性动作。

### Step 3：改造 Agent App 删除

1. `AppService.delete_app` 使用 `AgentDeletionService`。
2. 合并 Soul 删除和 `retire_all_for_app` 返回的 resource IDs。
3. commit 后 enqueue retention collection。
4. 保留现有公开 App related-data deletion task。
5. 保留 workflow-only candidate 的 post-commit ownership recheck。

Gate：

- `DELETE /agent/{id}` 后 Agent/App 主行均不存在；
- 所有相关 Working Environment 行已 RETIRED；
- 返回不等待 collector。

### Step 4：改造 workflow-only cleanup

1. 把 `WorkflowAgentRetirementService` 改为 `WorkflowAgentDeletionService`。
2. 删除 archive mutation 和 `account_id` 参数。
3. 有 owner 时保留；无 owner 时调用统一 Soul 删除。
4. fresh transaction commit 后由 service 自己 dispatch resource/App/Drive cleanup。
5. 更新 workflow、composer、DSL、snippet 和 App deletion 调用点。
6. 删除调用方重复的 collection enqueue。

Gate：

- workflow-only Agent 丢失最后有效 owner 后不残留 Agent/config/hidden App 主行；
- 同一 Agent 仍有 owner 时不删除；
- post-commit cleanup failure 不回滚已提交的产品变更。

### Step 5：删除 status 语义

1. 删除所有生产代码中的 `AgentStatus` import。
2. 删除创建时的 `status=ACTIVE`。
3. 删除 roster/composer/DSL/publish/App/snippet query status predicates。
4. validator/resolver 只判断 Agent 是否存在。
5. Home Snapshot validation 删除 Agent status 判断，但继续校验 Snapshot ACTIVE 和 owner。
6. 删除 `archive_roster_agent` 孤儿方法及其测试。

Gate：

- production Python 中没有 `AgentStatus`；
- Agent 存在即被视为可用；
- Working Environment status 过滤仍完整。

### Step 6：更新 API contract 和前端引用

1. 从 response models 和 serializer 删除 status/archive 字段。
2. 运行 contract generator。
3. 更新受影响的 frontend/test fixtures。
4. 不增加 archive/restore UI 或兼容 optional 字段。

Gate：

- OpenAPI 和 generated TypeScript 不再包含 AgentStatus；
- generated files 由工具生成；
- 前端无 archive 状态分支。

### Step 7：测试与文档

1. 更新 Agent model/migration tests。
2. 增加 `AgentDeletionService` focused unit tests。
3. 更新 App deletion 和 workflow-only ownership tests。
4. 更新 Drive ownership cleanup tests。
5. 更新 Snippet delete，使 commit-owning controller 在 commit 后显式 dispatch cleanup。
6. 更新 resolver/validator missing-Agent tests。
7. 更新 Agent Working Environment Architecture Doc 中的 Agent archive/delete 语义。
8. 运行相关 pytest、Ruff、contract check、frontend type/test checks 和 `git diff --check`。

不增加：

- ARCHIVED compatibility tests；
- delete/run race tests；
- Celery broker E2E；
- backend duplicate deletion tests；
- Enterprise tests；
- restore deleted Agent tests。

## 15. 测试范围

### 15.1 `AgentDeletionService`

覆盖：

- 删除 Agent、Draft、Snapshot、Revision、DebugConversation 和 WorkflowAgentNodeBinding；
- 全部 ACTIVE Home Snapshots 变为 RETIRED；
- 全部 ACTIVE Bindings 变为 RETIRED；
- 最后一个 Binding 退出时 Workspace 变为 RETIRED 并进入 result；
- Workspace 仍有其他 participant 时保持 ACTIVE；
- 其他 Soul 的数据不受影响；
- workflow-only hidden backing App 删除；
- workflow/snippet parent App 保留；
- transaction rollback 时数据库删除和 retire 全部回滚；
- commit 前不触发 collector、App cleanup 或 storage delete。

### 15.2 Drive

覆盖：

- 删除全部 AgentDriveFile；
- Drive-owned且无其他引用的 backing file row 删除并返回 storage key；
- 被另一个 Drive row 引用的 value 保留；
- `value_owned_by_drive=false` 只删除 manifest row；
- storage cleanup 只在 commit 成功后调用；
- storage delete 失败不恢复 Agent。

### 15.3 App 删除

覆盖：

- 删除 backing roster Agent 和 App；
- retire App Workspaces；
- enqueue 去重后的 Workspace/Binding/HomeSnapshot IDs；
- 触发现有 App related-data task；
- 再次读取 Agent 返回 not found。

### 15.4 Workflow-only ownership

覆盖：

- 仍有 draft owner 时保留 Agent；
- 仍有 current published owner 时保留 Agent；
- 无 owner 时物理删除 Agent/config 并 retire resources；
- hidden backing App 删除并触发异步关联数据清理；
- 已不存在的内部 candidate 安全跳过。

### 15.5 Query 与 contract

覆盖：

- roster 名称在 Agent 存在期间唯一，删除后可重用；
- Agent response 不含 status/archive 字段；
- archived-specific error/test 删除；
- runtime 对缺失 Agent 使用既有 unavailable/not-found error；
- generated contract 与 response model 一致。

## 16. 验收标准

1. `AgentStatus`、`agents.status`、`archived_by`、`archived_at` 全部删除。
2. Agent 生命周期只有“row exists / row absent”。
3. `DELETE /agent/{agent_id}` 物理删除 Agent Soul 和公开 Agent App 主行。
4. Config Draft、Config Snapshot、Config Revision、DebugConversation、Drive manifest 和 WorkflowAgentNodeBinding 不残留。
5. Drive-owned file value 按 ownership/ref 检查清理；非 owned value 不被误删。
6. Agent 的 ACTIVE Bindings 和 Home Snapshots 同步 RETIRED。
7. 只有最后一个 ACTIVE Binding 退出或 App delete 时 Workspace 才 RETIRED。
8. Working Environment 物理资源继续在 `retention` 队列异步 collect。
9. workflow-only Agent 丢失最后 owner 后物理删除，并删除其独占 hidden backing App。
10. 删除仍被 Workflow 引用的 roster Agent 不被阻止；规范化 binding 删除，后续 validation/runtime fail fast。
11. 版本 restore 仅适用于仍存在的 Agent，不能恢复已删除 Soul。
12. 不增加 runtime/delete 竞争协调、删除状态机、outbox、fallback 或兼容代码。
13. Dify Agent、Local/E2B backend protocol 和 Runtime Lease 模型不变。
14. API 和 generated contracts 不再暴露 Agent archive 状态。
