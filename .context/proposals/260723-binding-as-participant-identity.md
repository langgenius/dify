# Binding as Agent Participant Identity

## 1. 结论

`AgentWorkspaceBinding` 本身就是 Agent 在一个 Workspace 中 materialize 后产生的 participant/fork entity。

```text
agent_id   = Agent Soul / lineage identity
binding.id = participant identity
             = Materialized Home identity
             = Agenton session identity
```

同一个 Agent Soul 可以在同一个 Workspace 中创建多个 ACTIVE Bindings。每个 Binding 拥有独立的 Materialized Home、Agenton session snapshot 和 HITL pending state；这些 Bindings 只共享 Workspace。

本方案：

- 删除 `(tenant_id, workspace_id, agent_id, active_guard)` ACTIVE 唯一约束；
- 删除 `AgentWorkspaceBinding.active_guard`；
- 不增加 `participant_key`；
- 不增加 `AgentInstance` 或 Materialized Home 表；
- 不修改 Dify Agent backend protocol；
- 不增加兼容查询、fallback、dual read/write 或迁移 backfill。

Participant 的调用方必须在自己的持久化 schema 中保存准确的 `AgentWorkspaceBinding.id`。后续运行、恢复、文件访问、Build Apply 和 retire 都从该字段取得 Binding ID，不再通过 owner scope、Agent ID、更新时间或候选数量反向推断 participant。

## 2. 问题

当前数据模型把 `(Workspace, Agent)` 当作一个 ACTIVE Binding 的唯一身份，同时 Binding 又拥有 Materialized Home 和 session state。

这会把两个不同概念混在一起：

- `agent_id` 表示它们来自同一个 Agent Soul；
- `binding.id` 表示一次具体的 materialization 和参与实体。

当两个 participant 引用同一个 Agent Soul 时，按 Agent 复用 Binding 会让它们共享：

- Materialized Home；
- `session_snapshot`；
- `pending_form_id`；
- `pending_tool_call_id`；
- backend Binding ref；
- retire/collect 生命周期。

这种共享不是 Workspace 共享，而是 participant 私有状态泄漏。两个 participant 可能互相覆盖 Home 文件和 session 状态；一个 participant retire 时也会结束另一个 participant 使用的同一 Binding。

Binding 已经具备独立实体需要的全部身份和状态，继续使用 `agent_id` 作为唯一参与身份没有必要。

## 3. 目标

- 明确 Binding 是 workspace-scoped Agent participant/fork。
- 允许同一个 Agent Soul 在同一个 Workspace 中拥有多个 Bindings。
- 保证每个 Binding 拥有独立 Materialized Home 和 session state。
- 保持 Workspace 可以被多个 Bindings 共享。
- 所有 participant-specific 操作最终落到准确的 `binding.id`。
- 保持 Home Snapshot 不可变，并允许同一 Snapshot materialize 多次。
- 保持 Runtime Lease、retire/collect 和 backend opaque ref 边界不变。
- 让 Agent App Conversation、Build Draft 和 Workflow Node Execution 各自显式持有其 participant。

## 4. 非目标

- 不新增通用 participant registry。
- 不新增 `participant_key`、role slot 或 participant generation。
- 不新增 Materialized Home 表。
- 不让 Binding 脱离 Workspace 独立迁移或复用。
- 不实现 participant clone、rename、list 或选择 UI。
- 不修改 Agent Soul、Agent config 或 Home Snapshot 的版本模型。
- 不实现 current E2B 的共享 Workspace。
- 不增加并发 writer 锁、创建 idempotency key 或新的状态机。
- 不增加数据库兼容层、旧查询 alias 或双轨测试。
- 不保留 current/latest Binding 选择语义。
- 不让 API、Store 或文件服务通过候选集合推断 Binding ID。

## 5. 术语与关系

### 5.1 Agent Soul

`Agent` 及其 config/Home Snapshot lineage。它定义 participant 从哪里来，但不是 materialized participant 的身份。

### 5.2 Participant

一个 Agent Soul 在一个 Workspace 中的一次具体参与。Participant 的产品 identity 就是 `AgentWorkspaceBinding.id`。

Participant 创建时固定：

- `agent_id`
- `workspace_id`
- `base_home_snapshot_id`
- `agent_config_version_id`
- `agent_config_version_kind`

这些字段在 Binding 生命周期中不修改。

### 5.3 Materialized Home

由 Binding 从 `base_home_snapshot_id` materialize 得到的私有可变 Home。Materialized Home 的逻辑 identity 与生命周期都等于 Binding。

两个 Bindings 即使拥有相同的：

- `agent_id`
- `base_home_snapshot_id`
- config generation
- `workspace_id`

也必须拥有两个不同的 Materialized Homes。

### 5.4 Workspace

由产品 owner scope 拥有的可变共享文件空间。多个 Bindings 可以引用同一个 Workspace。

共享关系是：

```text
Caller C1 ─ Binding B1 ─┐
                        ├─ Workspace W
Caller C2 ─ Binding B2 ─┘

Binding B1 ─ Materialized Home H1
Binding B2 ─ Materialized Home H2
```

### 5.5 Runtime Lease

一次操作临时 acquire 某个准确 Binding 的数据平面能力。Runtime Lease 只看到该 Binding 的 Materialized Home 和它所连接的 Workspace。

Runtime Lease 不定义 participant identity，也不持久化。

### 5.6 Product Caller

Product Caller 是持有 participant 的业务对象，而不是新的 Working Environment 资源：

- Agent App normal：`Conversation`
- Agent App build：`draft_type=DEBUG_BUILD` 的 `AgentConfigDraft`
- Workflow：`WorkflowNodeExecutionModel`

Caller row 上的 `agent_workspace_binding_id` 表达“这个业务对象正在或曾经使用哪个 participant”。Caller 是单个 Binding 的直接产品所有者；Agent 只提供 Soul lineage，Workspace 只提供共享文件环境。

Caller 的生命周期决定何时 retire 自己的 Binding。Workspace 或 Agent 生命周期仍可批量 retire 它们包含或关联的 Bindings，但这类批量操作不是 participant identity resolution。

新 Binding ID 只写入发起创建的 caller row。产品代码不得把一个 ACTIVE Binding pointer 复制给另一个 caller；需要 fork 时必须创建新的 Binding。

## 6. 核心不变量

1. `AgentWorkspaceBinding.id` 是 participant、Materialized Home 和 session 的同一个逻辑 identity。
2. `agent_id` 只表达 Soul lineage，不构成 Workspace 内的 participant 唯一键。
3. 一个 Agent Soul 可以在同一个 Workspace 中拥有多个 ACTIVE Bindings。
4. 一个 Binding 只拥有一个 Materialized Home；两个 Bindings 永远不共享 Materialized Home。
5. 多个 Bindings 可以共享一个 Workspace。
6. 每个 Binding 独立保存 `session_snapshot` 和 HITL pending state。
7. Binding 的 base Home/config generation 创建后不可修改。
8. 使用已有 Binding 时，只校验该准确 Binding 的 generation；其他同 Soul Bindings 不参与判断。
9. 新 materialization 总是创建新的 Binding ID，不复用 RETIRED Binding ID。
10. retire 一个 Binding 只 retire 该 participant；Workspace 中仍有其他 ACTIVE Bindings 时 Workspace 保持 ACTIVE。
11. Runtime request、Build Apply、session save、retire 和 collect 都以准确 Binding ID 工作。
12. Participant 调用方必须持久保存准确 Binding ID；participant-specific 操作不得执行 0/1/多候选解析。
13. Workspace owner scope 只定位共享 Workspace，不定位 participant。
14. Agent ID、Workspace ID、Home Snapshot 和 config generation 都不能替代 Binding ID。
15. Dify API、Dify Agent 和 backend adapter 不得按 Agent/Workspace/generation 对 Binding create 做去重。
16. 按 Agent、App 或 Workspace 批量查询 Binding 只用于 lifecycle sweep，不得用于运行、恢复、文件访问或 Build Apply。
17. 一个 ACTIVE Binding pointer 不得被复制到另一个 caller；fork 必须产生新的 Binding ID。

## 7. 数据模型

### 7.1 `agent_workspace_bindings`

目标 schema：

```text
agent_workspace_bindings
  id                         StringUUID, primary key
  tenant_id                  StringUUID, not null
  app_id                     StringUUID, not null
  workspace_id               StringUUID, not null
  agent_id                   StringUUID, not null
  base_home_snapshot_id      StringUUID, not null
  agent_config_version_id    StringUUID, not null
  agent_config_version_kind  varchar(32), not null
  backend_binding_ref        varchar(255), not null
  session_snapshot           long text, nullable
  status                     varchar(32), not null       # active | retired
  retired_at                 datetime, nullable
  pending_form_id            StringUUID, nullable
  pending_tool_call_id       varchar(255), nullable
  created_at                 datetime, not null
  updated_at                 datetime, not null
```

保留索引：

```text
(tenant_id, workspace_id, status)
(tenant_id, agent_id, status)
(status, retired_at)
```

这些索引只服务于 Workspace last-active-Binding 判断、Agent/App retirement 和 retired GC，不用于解析 participant。

不增加替代唯一键。`id` 主键已经约束 participant identity；同一 Soul/Workspace 下的多个 participant 是合法数据。

### 7.2 删除项

从 `AgentWorkspaceBinding` 删除：

```text
active_guard
unique (tenant_id, workspace_id, agent_id, active_guard)
```

同时删除：

- model 中的 `agent_workspace_binding_agent_active_unique`；
- migration 中的 `active_guard` column；
- migration 中该 unique index 的 create/drop；
- create 时的 `active_guard=1`；
- retire 时的 `binding.active_guard=None`；
- fixture、factory 和测试中 Binding `active_guard` 的构造与断言。

`AgentWorkspace.active_guard` 和 Workspace owner ACTIVE 唯一约束继续保留。Workspace 仍然是 owner scope 下唯一的 current Workspace；本方案只修改 Binding identity。

### 7.3 调用方保存 Binding ID

三个实际拥有 participant 的调用方直接增加 nullable logical reference：

```text
conversations
  agent_workspace_binding_id       StringUUID, nullable

agent_config_drafts
  agent_workspace_binding_id       StringUUID, nullable

workflow_node_executions
  agent_workspace_binding_id       StringUUID, nullable
```

字段语义：

- `Conversation.agent_workspace_binding_id`：该 Agent App conversation 使用的 participant；
- `AgentConfigDraft.agent_workspace_binding_id`：仅 `draft_type=DEBUG_BUILD` 使用，表示该 build draft 的 participant；
- `WorkflowNodeExecutionModel.agent_workspace_binding_id`：该次 Agent node execution 使用的 participant。

字段为 null 表示调用方尚未 materialize participant。首次执行时显式创建 Binding 并写入该字段；字段非 null 时只能按该 ID 解析和校验准确 Binding。

这些字段不建立数据库外键：

- Binding row 是可 collection 的资源账本记录；
- Conversation、Draft 或 Workflow execution row 可能比 Binding row 保留得更久；
- 调用方保留的 ID 可以作为历史 identity，但不能阻止 retired Binding 被删除。

ACTIVE 调用方引用的 Binding 不存在、非 ACTIVE 或 owner 不匹配时必须 fail fast；不得清空字段后隐式创建替代 Binding。

不为这些字段增加 lookup index 或 unique index。正向读取始终先按调用方自己的主键取得 row，Binding 的 owner 与 tenant 校验由 exact resolve 完成。

### 7.4 不增加的 schema

不增加：

- `participant_key`
- `participant_id`
- `agent_instances`
- `materialized_homes`
- participant 到 Binding 的 mapping table
- Binding replacement/version table
- Binding 上的 `caller_type` / `caller_id`

Binding row 本身就是 participant record；产品所有权引用保存在实际 caller row 上，不在 Binding 上复制反向 owner。

### 7.5 Migration 策略

本分支的 Working Environment schema 直接以最终模型生成：

- 直接修改创建 `agent_workspace_bindings` 的 migration；
- 在同一最终 migration 中为三个调用方表增加 `agent_workspace_binding_id`；
- migration 初始创建时不包含 Binding `active_guard` 和 Agent ACTIVE unique index；
- 不新增只用于兼容当前中间 schema 的 follow-up migration；
- 不做 Binding pointer backfill、dual schema 或兼容性测试；既有 null pointer 在首次实际使用时按正常 create 流程初始化；
- 本地隔离开发数据库按最终 migration 重新创建。

## 8. Dify API Service 设计

### 8.1 `AgentWorkspaceService`

目标接口：

```text
resolve_active_workspace(session, owner_scope) -> Workspace?

get_active_binding(
  session,
  tenant_id,
  binding_id,
  expected_owner_scope
) -> Binding?

create_binding(
  session,
  owner_scope,
  agent_id,
  base_home_snapshot_id,
  agent_config_version_id,
  agent_config_version_kind
) -> Binding

validate_binding_generation(
  binding,
  base_home_snapshot_id,
  agent_config_version_id,
  agent_config_version_kind
)

save_binding_session_snapshot(binding_id, ...)
retire_binding(binding_id)
retire_workspace(workspace_id)
collect_retired_binding(binding_id)
collect_retired_workspace(workspace_id)
```

`resolve_active_workspace` 只用于创建 Binding 时复用 owner 当前 Workspace，以及 Workspace lifecycle 操作；它的返回值不能继续用于搜索 participant。

Agent/App/Workspace retirement 所需的批量 Binding 查询保留为 lifecycle-internal 能力。这些方法返回集合是为了同步 retire 一组资源，不向 Product Store、runtime、Build Apply 或文件服务提供 participant 选择能力。

### 8.2 删除 Agent-based identity API

删除通用接口：

```text
resolve_active_binding(owner_scope, agent_id)
create_or_resolve_binding(owner_scope, agent/config scope)
```

原因：

- `agent_id` 不能唯一定位 participant；
- `create_or_resolve` 会把“同 Soul”错误解释为“同 participant”；
- 创建 participant 和解析 participant 是两个不同动作。

同时不提供面向运行调用方的通用 `list_active_bindings`。`create_binding` 总是创建新的 Binding identity；是否已有 participant 只由调用方 row 上保存的 `agent_workspace_binding_id` 决定。

### 8.3 Exact Binding resolve

`get_active_binding` 必须校验：

- `tenant_id`
- `binding.id`
- `status=ACTIVE`
- expected owner scope

调用方提供 config/Home generation 时，再对该 Binding 执行 generation validation。

其他同 `agent_id` Binding 不参与该查询。

### 8.4 Binding create

创建流程保持：

1. 校验 owner scope 和 ACTIVE base Home Snapshot。
2. resolve 当前 ACTIVE Workspace；没有则生成 Workspace ID。
3. 生成新的 Binding ID。
4. 调用 Dify Agent `create_execution_binding`。
5. Workspace 已存在时传其 `backend_workspace_ref`。
6. 在调用方持有的同一数据库 session 中保存新的 Workspace/Binding row 和 backend ref。
7. 调用方在同一 transaction 中把 Binding ID 写入自己的 pointer 字段。
8. transaction owner commit 后返回新 Binding ID。

同一 Agent/Snapshot/config 对同一 Workspace 调用两次 `create_binding`，应产生两个合法 Binding rows 和两个 Materialized Homes。

`create_binding` 不自行 commit。Agent App、Build Draft 或 Workflow application service 只在首次创建 participant 的局部 scope 内同时提交 Binding ledger row 与 caller pointer。

数据库/外部资源一致性继续遵循现有方案：backend 尚未成功返回前清理 partial create；backend 成功后的数据库 commit 失败不做 API-side 即时补偿，留给未来 global reconciler。

### 8.5 Generation validation

保留 `AgentWorkspaceBindingGenerationMismatchError`，但改变它的适用范围：

- 对准确 Binding ID 的后续使用进行校验；
- 调用方从自己的 pointer 取得准确 Binding 后进行校验；
- 不再用于阻止同一 Agent 在同一 Workspace 创建另一个 generation 的 Binding。

允许：

```text
Workspace W
  Binding B1 -> Agent A, Home H1, Config C1
  Binding B2 -> Agent A, Home H2, Config C2
```

不允许把 B1 原地改成 H2/C2。

### 8.6 `AgentHomeSnapshotService`

Build Apply 的 Home Snapshot 接口为：

```text
create_initial(session, tenant_id, agent_id) -> AgentHomeSnapshot
create_for_build_apply(session, build_draft) -> AgentHomeSnapshot
retire_all_for_agent(session, tenant_id, agent_id) -> home_snapshot_ids
collect_retired_home_snapshot(tenant_id, home_snapshot_id)
```

`create_for_build_apply` 自己从 `build_draft.agent_workspace_binding_id` 取得 source Binding，调用 `get_active_binding` 校验 tenant、`BUILD_DRAFT / draft.id` owner、Agent 和 generation，再执行 checkpoint。

删除由 Composer/controller 额外解析并传入 `source_binding_id` 的接口。Home Snapshot service 的用户只提供 Build Draft，不接触 backend ref，也不承担 participant 选择。

## 9. Product Caller 与 Binding Pointer

Binding 是 participant identity，调用方 schema 上的 `agent_workspace_binding_id` 是唯一解析入口。Product Store 不提供 candidate list，不根据数量决定 create/reuse，也不使用更新时间选择 participant。

该 pointer 是 Dify API 数据库中的 server-side reference。浏览器和公共 API 仍以 caller ID 工作，不能提交任意 Binding ID 或 backend ref。

### 9.1 统一调用规则

每个 Product Store 都只执行以下流程：

```text
load exact caller row
  pointer is null
    -> explicitly create one Binding
    -> save Binding.id into caller row in the same DB transaction
  pointer is set
    -> get_active_binding(pointer)
    -> validate owner scope and generation
```

规则：

- null pointer 只表示该调用方从未创建 participant，不表示应搜索可能存在的 Binding；
- non-null pointer 只解析该 Binding，不搜索同 owner、Workspace 或 Agent 的其他 Bindings；
- pointer 指向 retired/missing Binding 时 fail fast，不自动置 null、不 rematerialize；
- 调用方终止后 pointer 可以作为历史 identity 保留，Binding collector 不依赖也不更新这些 pointer；
- 创建另一个 participant 必须由明确的产品 lifecycle action 创建新 caller，或先 retire 旧 Binding 后显式重置可复用 caller 的 pointer；不能让运行服务猜测替代对象。

### 9.2 Agent App Conversation

普通 Agent App 运行由 `Conversation.agent_workspace_binding_id` 持有 participant：

1. `AgentAppWorkspaceStore` 加载准确 Conversation；
2. pointer 为 null 时，以 `CONVERSATION / conversation.id` 为 owner scope 创建 Binding 并写回 Conversation；
3. pointer 非 null 时按 ID 加载；
4. 多轮运行、session save、HITL resume 和文件访问均沿用该 ID。

Store 接口改为以 caller identity 为入口：

```text
load_or_create_conversation_session(conversation_id, expected_generation) -> StoredAgentAppSession
load_or_create_build_session(build_draft_id, expected_generation) -> StoredAgentAppSession
```

删除只接收 Agent/owner scope、内部再寻找 Binding 的通用 `resolve_or_create`。`AgentAppSessionScope.workspace_owner` 也不再根据 `agent_config_version_kind` 推断 caller 并把 `conversation_id` 同时用于 normal/build；normal runner 显式传 Conversation ID，build runner 显式传 Build Draft ID。

`AgentDebugConversation` 只负责定位当前账号的 debug Conversation，不再参与 Binding 查询。`StoredAgentAppSession.binding_id` 继续表示 runtime `AgentWorkspaceBinding.id`。

Conversation 的 Workspace owner 仍是 `CONVERSATION / conversation.id`；这是 Workspace 身份，同时也是 pointer owner 校验条件，不是 Binding 查询条件。

### 9.3 Build Draft

Build participant 由 `AgentConfigDraft.agent_workspace_binding_id` 持有，仅适用于 `draft_type=DEBUG_BUILD`：

1. 首次 Build 运行以 `BUILD_DRAFT / draft.id` 为 owner scope 创建 Binding；
2. 在同一 transaction 中把 Binding ID 写入 Build Draft；
3. 后续 Build 运行和 Build 文件访问从 Draft pointer 取得准确 Binding；
4. Build Apply 从同一 pointer checkpoint Home Snapshot；
5. Apply 或 discard retire 该 Binding，并按既有产品流程删除或终止 Draft。

强制 checkout 是显式 reset：若 Draft 已有 pointer，先同步 retire 旧 Binding，再重置 Draft pointer；下一次 Build 运行创建新 participant。它不是运行失败后的 fallback。

普通 Conversation 与 Build Draft 分别保存自己的 Binding ID。不得在两者之间按 `updated_at`、Workspace 活跃时间或 Agent ID选择“当前” participant。

### 9.4 Workflow Agent Node Execution

Workflow participant 由 `WorkflowNodeExecutionModel.agent_workspace_binding_id` 持有：

1. 每个实际 Agent node execution row 是 participant 调用方；
2. 首次运行创建 Binding，并由 Workflow persistence 在同一 transaction 中写入该 execution row；
3. pause/resume、retry continuation、session save 和运行中文件访问按该字段恢复准确 Binding；
4. 新 node execution 创建自己的 Binding；不复制 pointer，也不搜索同 node、同 config binding 或同 Agent 的历史 Binding。

Store 接口改为：

```text
load_or_create_node_execution_session(node_execution_id, expected_generation) -> StoredWorkflowAgentSession
```

同时消除两类 Binding ID 的命名歧义：

- `WorkflowAgentSessionScope.binding_id` 改为 `workflow_agent_binding_id`，表示 `WorkflowAgentNodeBinding.id`；
- `StoredWorkflowAgentSession.binding_id` 与 `WorkflowNodeExecutionModel.agent_workspace_binding_id` 表示 runtime `AgentWorkspaceBinding.id`。
- Agent node `process_data["binding_id"]` 改为 `process_data["workflow_agent_binding_id"]`，不得把配置 Binding ID 写入 runtime participant 字段。

Workflow Workspace 的 `owner_scope_key=f"{node_id}:{workflow_agent_binding_id}"` 保持不变。它只区分一个 run 内的共享 Workspace scope；具体 node execution 使用哪个 participant，由 `WorkflowNodeExecutionModel.agent_workspace_binding_id` 决定。

不新增 Workflow participant mapping table。

### 9.5 Workspace 文件接口

文件接口仍不暴露 backend opaque ref，但请求必须准确指向保存 participant pointer 的调用方：

- Agent App normal：Conversation ID；
- Build：Build Draft ID；
- Workflow：Workflow Node Execution ID。

Dify API 加载对应 caller row，读取其 `agent_workspace_binding_id`，校验 tenant/app/account、Binding owner scope 和 ACTIVE 状态，再把 `backend_binding_ref` 发给 Dify Agent。请求 payload 不接受客户端提供的 Binding ID。

现有把 conversation/build 混为“latest Workspace”的接口 schema 必须拆清 owner kind 或改为接收准确 caller ID；不增加兼容字段，也不保留 latest Binding fallback。浏览器无需保存 backend ref，也无需自行选择 participant。

## 10. Lifecycle 与所有权

### 10.1 所有权

| 对象 | 直接逻辑所有者 | 退出依据 |
|---|---|---|
| Home Snapshot | Agent/config reference | Agent 与配置引用生命周期 |
| Workspace | Product owner scope | Conversation、Build Draft 或 Workflow Run |
| Binding / Participant | 保存 pointer 的 Product Caller | Caller 结束或显式 reset |
| Materialized Home | Binding | 与 Binding 同生共死 |
| Runtime Lease | 当前 operation | operation scope |
| 物理 Sandbox | Backend adapter | 后端映射，不成为产品 owner |

Binding 同时引用 Agent 与 Workspace，但两者分别表示 Soul lineage 与共享环境，不构成单个 participant 的直接 caller identity。

三类上层退出都合法：

- Caller 退出：按 caller pointer retire 一个 Binding；
- Workspace 退出：retire Workspace 内全部 ACTIVE Bindings；
- Agent/App 退出：按 lineage 或应用边界批量 retire 关联 Bindings。

后两类是 lifecycle sweep，不改变“单个 participant 只能由 caller pointer 精确解析”的规则。

### 10.2 Binding

Binding 生命周期保持：

```text
ACTIVE -> RETIRED -> row deleted
```

状态字段：

```text
status
retired_at
```

Binding ID 不复用，因此不需要 `active_guard`。

### 10.3 Participant retire

`retire_binding(binding_id)`：

1. 锁定准确 ACTIVE Binding；
2. 设置 `status=RETIRED` 和 `retired_at`；
3. 查询同 Workspace 的其他 ACTIVE Bindings，不按 Agent 分组；
4. 仍有其他 Bindings时保留 Workspace；
5. 没有其他 Bindings 时同时 retire Workspace。

retire B1 不影响同 Agent 的 B2。

### 10.4 Workspace retire

Workspace retire 继续 retire 其全部 ACTIVE Bindings。每个 Binding 的 Materialized Home 和 session 都独立进入 collection。

Workspace collector 的 anchor Binding、Local binding-only destroy 和 current E2B coupled destroy 逻辑不变。

### 10.5 Agent retirement

Agent archive/delete 继续按 `agent_id` 查询并 retire 该 Soul 的全部 ACTIVE Bindings。

这里使用 `agent_id` 是批量所有权操作，不是 participant identity resolve。

### 10.6 Build Apply

Build Apply 必须：

1. 加载准确 `draft_type=DEBUG_BUILD` 的 `AgentConfigDraft` row；
2. 从 `AgentConfigDraft.agent_workspace_binding_id` 获得准确 `source_binding_id`；
3. 校验 Binding 为 ACTIVE，且 owner 是 `BUILD_DRAFT / draft.id`；
4. 从该 Binding 的 Materialized Home checkpoint 新 Home Snapshot；
5. 更新 normal draft 的 `home_snapshot_id`；
6. retire 该 source Binding；
7. 其他同 Soul participant 不受影响。

Build Draft pointer 为 null、Binding 不存在或 owner 不匹配时 Apply fail fast。

删除按 `agent_id + latest updated_at` 或候选数量选择 Build Binding 的行为。

### 10.7 Caller pointer 生命周期

Caller pointer 不是资源状态机：

```text
null -> Binding ID
Binding ID -- explicit product reset --> null
```

- null 到 Binding ID 与首次 Binding ledger 写入在同一数据库 transaction 中完成；
- 运行路径不原地替换 pointer；
- 明确的产品 reset 操作可以先 retire 旧 Binding，再重置可复用 caller 的 pointer；
- caller 终止后 pointer 可以保留为历史 identity；
- Binding retire/collect 不反向扫描或清空 caller pointer；
- 新 participant 由新 caller row 或显式 reset 后的 caller 持有新的 Binding ID。

资源可用性仍只由 Binding 的 `ACTIVE -> RETIRED -> row deleted` 管理。

### 10.8 产品触发点

| 产品事件 | Caller pointer | Binding / Workspace | Runtime Lease |
|---|---|---|---|
| 首次 Agent request | null 时写入新 Binding ID | 创建 Binding；按 owner scope 创建或复用 Workspace | acquire / release |
| 后续 Agent request | 读取准确 Binding ID | 保留 | acquire / release |
| request 结束 | 不变 | 保留 | release |
| request 后文件访问 | 读取准确 Binding ID | 保留 | acquire / release |
| Build Apply | 从 Draft pointer 取 source | checkpoint 后 retire source；最后一个 Binding 退出时 retire Workspace | acquire / release |
| Build Discard | 读取 Draft pointer | retire source；按 last-active 规则 retire Workspace | 无 |
| Build force checkout | 显式 reset | 先 retire 旧 source | 无 |
| Conversation 删除 | 读取 Conversation pointer | retire participant；按 last-active 规则 retire Workspace | 无 |
| Workflow 到达终态 | execution pointers 可保留 | retire run Workspaces 及其中全部 Bindings | 无 |
| Agent/App archive 或删除 | 不用于解析单个 participant | lifecycle sweep 关联 Bindings/Workspaces | 无 |
| 异步 collect | 不读取、不更新 | 物理删除成功后删除资源账本行 | operation-local |

Retention task payload 仍只携带 `tenant_id` 与 Binding/Workspace/Home Snapshot logical IDs。Caller pointer 不是资源，不进入 `retention` 队列；collector 也不需要扫描 caller 表。

## 11. Dify Agent 与物理后端

### 11.1 Backend protocol

以下接口不变：

```text
ExecutionBindingCreateSpec.binding_id
ExecutionBindingBackend.create_binding
ExecutionBindingBackend.acquire
ExecutionBindingBackend.release
ExecutionBindingBackend.destroy_binding
HomeSnapshotBackend.create_from_runtime
RuntimeLease
```

`ExecutionBindingCreateSpec.binding_id` 已经是 physical Binding/Materialized Home 的逻辑 identity，不增加 participant 字段。

协议字段语义收紧为：

- `binding_id`：权威 participant identity；
- `agent_id`：Soul lineage metadata，不参与物理资源去重；
- `workspace_id` / `existing_workspace_ref`：共享 Workspace identity，不参与 Materialized Home 去重；
- 每个新的 `binding_id` 必须创建新的 Materialized Home，即使 Agent、Snapshot、config 和 Workspace 全部相同；
- `destroy_binding` 只销毁目标 Binding 的 Materialized Home，并按显式 `destroy_workspace` 决定是否同时销毁 Workspace。

Dify Agent 仍不保存 caller pointer、不连接产品数据库，也不建立 `binding_id -> caller` 映射。它只接收 Dify API 已解析好的 logical ID 和 opaque ref；participant 的产品所有权完全留在 Dify API。

### 11.2 Local backend

Local 已按 Binding ID 分配：

```text
materialized_home_root/<binding_id>
workspace_root/<workspace_id>
```

同一 Agent 在同一 Workspace 创建 B1/B2 时：

- B1、B2 返回不同 `binding_ref`；
- B1、B2 使用不同 Home 目录；
- 两者返回同一个 `workspace_ref`；
- retire B1 可以只删除 H1；
- B2 和 Workspace 保持可用。

Local 只需要补充同 Soul fork 的契约测试，不需要改变目录或协议。

### 11.3 Current E2B

Current E2B 仍然不支持将第二个 Binding 接入已有 Workspace：

- 第一个 Binding 正常创建；
- 第二个 Binding 收到非空 `existing_workspace_ref`；
- 返回 `shared_workspace_unsupported`；
- Dify API 不创建 Binding row；
- 不复制 Workspace，不创建伪共享 Workspace，不 fallback 到 Local。

这是 current E2B 的物理能力限制，不恢复 Agent ACTIVE 唯一约束。

## 12. Runtime 与 session

Runtime request 已携带：

```text
binding_id
backend_binding_ref
```

这些字段继续表示准确 participant。

每个 Binding 独立保存：

```text
session_snapshot
pending_form_id
pending_tool_call_id
```

禁止：

- 按 `agent_id` 保存 session；
- 在多个 Bindings 间复制 session；
- 当 Binding ID 丢失时选择同 Agent 的另一个 Binding；
- generation mismatch 时创建 fallback Binding；
- backend Binding 丢失时自动 rematerialize。

`run_id` 仍然只属于一次 request，不进入 Binding identity。

## 13. 错误语义

| 情况 | 结果 |
|---|---|
| caller pointer 为 null，但操作要求已有 participant | `binding_not_found` |
| Binding ID 不存在或非 ACTIVE | `binding_not_found` |
| Binding 不属于 expected tenant/owner scope | `binding_not_found` |
| 准确 Binding 的 config/Home generation 不匹配 | `binding_generation_mismatch` |
| base Home Snapshot 不可用 | 现有 Home Snapshot unavailable error |
| Local 同 Soul 创建第二 Binding | 正常创建 |
| E2B 对已有 Workspace 创建第二 Binding | `shared_workspace_unsupported` |
| participant backend resource 丢失 | `binding_lost` |

不增加自动选择、latest Binding fallback 或兼容 error alias。

## 14. 明确删除清单

### 14.1 Schema/model

- `AgentWorkspaceBinding.active_guard`
- `agent_workspace_binding_agent_active_unique`
- migration 中 Binding `active_guard`
- migration 中该 unique index 及 downgrade drop

### 14.2 Service

- `resolve_active_binding(owner_scope, agent_id)` 的通用接口和语义
- `create_or_resolve_binding(owner_scope, agent/config scope)` 的通用接口和语义
- 面向运行调用方的 `list_active_bindings(owner_scope, agent_id?)`
- 将同 Agent 视为同 participant 的查询
- 任何 0/1/多候选解析与 `ambiguous_binding`
- retire Binding 时写 `active_guard=None`
- create Binding 时写 `active_guard=1`
- Build Binding 的 latest-row 猜测
- `AgentHomeSnapshotService.create_for_build_apply(..., source_binding_id)` 的调用方参数

### 14.3 Product store

- `WorkflowAgentSessionScope.binding_id` 表示 Workflow config binding 的歧义命名
- Agent node `process_data["binding_id"]` 表示 Workflow config binding 的歧义命名
- `AgentAppSessionScope.workspace_owner` 通过 generation kind 推断 caller、并让 build 复用 `conversation_id` 的语义
- 通过 `agent_id` 静默选择任意 participant
- 多候选时按 `updated_at` 选择 Binding
- conversation/build current/latest Binding 选择
- `resolve_latest_active_conversation_binding`

### 14.4 Tests/docs

- “一个 Agent 在一个 Workspace 中最多一个 ACTIVE Binding”的断言
- Binding `active_guard` fixture 和测试
- generation mismatch 用于阻止同 Soul fork 的测试
- 同 participant 共享 Materialized Home 的描述
- “Binding 的直接产品所有者是 Agent 与 Workspace 关系”的描述
- “产品 caller 只提供 locator，不持久保存 participant identity”的描述
- 旧 service 方法 alias、兼容 payload 和兼容性测试

### 14.5 保留项

以下不删除：

- Workspace `active_guard`
- Binding `status/retired_at`
- `base_home_snapshot_id`
- `agent_config_version_id/kind`
- `AgentWorkspaceBindingGenerationMismatchError`
- Runtime Lease
- backend `binding_id` 和 opaque refs
- synchronous retire / asynchronous collect

## 15. 代码修改范围

### 15.1 Dify API models/migration

- `api/models/agent.py`
- `api/models/model.py`
- `api/models/workflow.py`
- `api/migrations/versions/2026_07_23_0203-f6e4c5686857_replace_agent_runtime_sessions_with_.py`
- `api/tests/unit_tests/migrations/test_agent_workspace_migration.py`

### 15.2 Resource service

- `api/services/agent/workspace_service.py`
- `api/tests/unit_tests/services/agent/test_workspace_service.py`
- `api/services/agent/home_snapshot_service.py`
- `api/services/agent/composer_service.py`
- Build Apply 相关 service tests

Home Snapshot service 的 backend 协议不变；`create_for_build_apply` 改为从 Build Draft pointer exact resolve source Binding，不再接收上层解析的 `source_binding_id`。

### 15.3 Agent App

- `api/core/app/apps/agent_app/session_store.py`
- `api/core/app/apps/agent_app/app_runner.py`
- 对应 session store、runner tests

Store 改为读写 `Conversation.agent_workspace_binding_id` 或 `AgentConfigDraft.agent_workspace_binding_id`。Runner/session scope 显式传 Conversation ID 或 Build Draft ID，不再用 generation kind 推断 caller。Runtime request builder 的 Binding 字段已经正确。

### 15.4 Workflow

- `api/core/workflow/nodes/agent_v2/session_store.py`
- `api/core/workflow/nodes/agent_v2/agent_node.py`
- Workflow node execution persistence 相关代码
- 对应 session store、node tests

重点是持久化 `WorkflowNodeExecutionModel.agent_workspace_binding_id`，并把 session scope 与 process data 中的 Workflow config Binding 统一命名为 `workflow_agent_binding_id`。

### 15.5 文件访问

- `api/services/agent_app_sandbox_service.py`
- `api/controllers/console/app/agent_app_sandbox.py`
- Workflow Agent node 文件接口及其 request schema
- 对应 service/controller tests

HTTP schema 改为准确定位 Conversation、Build Draft 或 Workflow Node Execution；不增加兼容字段。

### 15.6 Web 调用方

- `web/features/agent-v2/agent-detail/configure/components/preview/working-directory-panel.tsx`
- `web/features/agent-v2/agent-detail/configure/components/preview/hook/use-working-directory-panel.tsx`
- 对应 Working Directory tests

Agent Working Directory source schema 必须携带准确 caller identity：normal 使用 Conversation ID，build 使用 Build Draft ID，workflow 使用 Workflow Node Execution ID。后端 OpenAPI schema 修改后通过生成工具刷新 client，不手工修改生成文件。

### 15.7 Dify Agent

生产代码无需修改：

- `dify_agent/runtime_backend/protocols.py`
- Local/E2B backend interfaces
- execution binding routes
- Runtime layer

只补充或调整 Local/E2B contract tests 和公开 runtime-resource 文档。

### 15.8 Architecture docs

- `.context/docs/260723-agent-working-environment-architecture-doc.md`
- `dify-agent/docs/dify-agent/concepts/runtime-resources/index.md`

文档统一改为 Binding-as-participant identity，删除 Agent ACTIVE unique 语义。

Architecture Doc 必须同步更新：

- 核心关系图和所有权表：Product Caller owns Binding/Participant；
- 状态存储表：caller pointer 位于 Dify API 业务表；
- Workspace 章节：owner scope 只定位 Workspace；
- 数据模型：删除 Binding `active_guard`，增加三个 caller pointer；
- Dify API service 与 Product Store 接口；
- Agent request、文件访问和 Build Apply 流程；
- Dify Agent/backend contract：`binding_id` 权威、`agent_id` 仅 lineage；
- 代码分层表：caller pointer persistence 属于产品控制平面。

## 16. 测试方案

### 16.1 Schema

- `agent_workspace_bindings` 不含 `active_guard`。
- 不存在 `agent_workspace_binding_agent_active_unique`。
- Workspace 的 owner ACTIVE unique index 保持存在。
- 同 tenant/workspace/agent 可以插入两个 ACTIVE Binding rows。
- 三个 caller 表包含 nullable `agent_workspace_binding_id`。
- caller pointer 不带外键、lookup index 或 unique index。

### 16.2 Service

- `create_binding` 每次生成新的 Binding ID。
- 同 Agent、同 Workspace、同 Snapshot/config 可以创建 B1/B2。
- B1/B2 拥有不同 `backend_binding_ref`。
- `get_active_binding(B1)` 不会返回 B2。
- generation validation 只校验目标 Binding。
- Service 不提供 candidate-based participant resolver。

### 16.3 Caller pointer

- Conversation null pointer 首次运行后写入新 Binding ID。
- Conversation non-null pointer 只加载该 Binding。
- Build Draft 与 normal Conversation 保存不同 Binding ID。
- Agent App build owner 使用 Build Draft ID，不复用 Conversation ID。
- Workflow Node Execution 首次运行保存自己的 Binding ID。
- 创建第二 caller 时生成新 Binding ID，不复制第一个 caller 的 pointer。
- pointer 指向 retired/missing Binding 时 fail fast，不创建替代 Binding。
- 同 owner scope 中存在其他 Bindings 不影响 exact pointer resolve。
- 文件请求只提交 caller ID；客户端提供任意 Binding ID 不参与解析。
- Workflow Workspace scope 仍使用 `node_id + workflow_agent_binding_id`，runtime participant 只从 execution pointer 取得。

### 16.4 Session

- B1/B2 分别保存和加载自己的 `session_snapshot`。
- B1 的 pending form/tool state 不出现在 B2。
- session save 只接受准确 Binding ID。

### 16.5 Lifecycle

- retire B1 后 B2 保持 ACTIVE。
- B2 存在时 Workspace 保持 ACTIVE。
- retire 最后一个 Binding 时 Workspace RETIRED。
- Agent retirement retire 该 Agent 的全部 Bindings。
- collector 仍按逻辑 ID 幂等工作。
- collect 删除 Binding row 时不要求清空 caller 的历史 pointer。
- retention task payload 不包含 caller ID 或 pointer。
- Agent/App/Workspace lifecycle sweep 可以 retire 多个 Bindings，但运行 Store 无集合解析接口。

### 16.6 Build Apply

- Apply 从准确 source Binding checkpoint。
- source Binding ID 只从 Build Draft pointer 读取。
- Home Snapshot service 的 Build Apply 接口不接受调用方传入的 `source_binding_id`。
- B1 Apply 不使用 B2 的 Home。
- Draft pointer 为 null 或 owner mismatch 时 fail fast。
- Apply 不 retire 其他同 Soul Binding。

### 16.7 Local backend

- 同一 Home Snapshot 创建 B1/B2。
- B1/B2 连接同一个 Workspace ref。
- 相同 Agent/Snapshot/config/Workspace 的新 Binding ID 不被 backend 去重。
- 两个 lease 的 `home_dir` 不同，`workspace_dir` 相同。
- B1 Home 写入对 B2 Home 不可见。
- Workspace 写入对 B1/B2 均可见。
- binding-only destroy B1 后 B2/Workspace 可用。

### 16.8 E2B

- 首个 Binding 创建成功。
- 对相同 Workspace 创建第二 Binding返回 `shared_workspace_unsupported`。
- 不创建 fallback Sandbox/Workspace。
- 既有 acquire/release/pause 和 coupled destroy 测试保持。

### 16.9 测试边界

不增加：

- 兼容旧 unique schema 的测试；
- `active_guard` 迁移 backfill 测试；
- participant key 测试；
- 多 participant UI/E2E；
- 并发创建压力测试；
- backend fallback 测试；
- Enterprise 实现测试；
- candidate 数量和 `ambiguous_binding` 测试。

## 17. 实现步骤

### Step 1：收敛数据模型

1. 从 `AgentWorkspaceBinding` 删除 `active_guard`。
2. 删除 Agent ACTIVE unique index。
3. 为 Conversation、Build Draft 和 Workflow Node Execution 增加 `agent_workspace_binding_id`。
4. 直接更新最终 migration 和 migration test，不增加 follow-up migration。
5. 更新 model docstring，明确 Binding 是 participant/fork identity。

Gate：

- schema 中无 Binding `active_guard`；
- 同 Soul/Workspace 的两个 ACTIVE rows 可存在；
- 三个 caller schema 可显式保存 Binding ID；
- Workspace owner 唯一性未受影响。

### Step 2：重构 `AgentWorkspaceService`

1. 增加 exact `get_active_binding(binding_id)`。
2. 将 `create_or_resolve_binding` 改为显式、caller-session-aware 的 `create_binding`。
3. 删除 runtime 使用的 Agent/owner-scoped Binding list 与 candidate resolver。
4. 保留 generation validation，但只作用于 pointer 指向的准确 Binding。
5. 从 retire 路径删除 Binding `active_guard` 写入。
6. 保持 Workspace last-active-Binding 判断与 collection 不变。
7. 将 Agent/App/Workspace 批量查询限制在 lifecycle-internal 调用点。

Gate：

- service 不再把 `agent_id` 当成 Binding identity；
- create 两次得到两个 participant；
- exact get/save/retire 只影响目标 Binding。

### Step 3：接入 Agent App 与 Build Draft pointer

1. Agent App normal path 读写 `Conversation.agent_workspace_binding_id`。
2. Build path 读写 `AgentConfigDraft.agent_workspace_binding_id`。
3. Runner/session scope 显式传 Conversation ID 或 Build Draft ID，不从 generation kind 推断 caller。
4. Build Workspace owner 改为 `BUILD_DRAFT / draft.id`。
5. 首次 create 时在一个局部 transaction 中提交 caller pointer 与 Workspace/Binding ledger。
6. Build Apply、discard、session save 和 HITL resume 只使用 pointer 指向的 Binding。
7. 强制 checkout 显式 retire 旧 Build Binding 并重置 Draft pointer。
8. `AgentHomeSnapshotService.create_for_build_apply` 自己读取 Draft pointer。
9. 删除 Agent App 的 generic Agent-based 与 latest conversation resolver 调用。

Gate：

- 当前 Agent App 多轮运行继续复用同一 participant；
- normal Conversation 与 Build Draft 可以引用同 Soul 的不同 participants；
- Build Apply 不执行 Binding 搜索。

### Step 4：接入 Workflow Node Execution pointer

1. Workflow session store 读写 `WorkflowNodeExecutionModel.agent_workspace_binding_id`。
2. 首次 create 时在一个局部 transaction 中提交 execution pointer 与 Workspace/Binding ledger。
3. `WorkflowAgentSessionScope.binding_id` 重命名为 `workflow_agent_binding_id`。
4. `process_data["binding_id"]` 重命名为 `process_data["workflow_agent_binding_id"]`。
5. Runtime、pause/resume、session save 继续传准确 runtime Binding ID。
6. 保持 Workspace `owner_scope_key=node_id:workflow_agent_binding_id`，但不再用它解析 participant。
7. 删除 Workflow 的 owner/Agent candidate resolver 调用。

Gate：

- 一个 node execution 的重入始终使用其 pointer；
- 两个 node executions 可以引用同 Soul 的不同 participants；
- Workflow 不按 node/config/Agent 搜索 participant。

### Step 5：收紧文件接口

1. Agent App normal 文件请求准确定位 Conversation。
2. Build 文件请求准确定位 Build Draft。
3. Workflow 文件请求准确定位 Workflow Node Execution。
4. Service 从 caller pointer exact resolve Binding，并校验 owner。
5. 删除 current/latest Workspace 或 Binding 选择代码。
6. 公共 schema 不接受 Binding/backend ref，只接受 caller identity。

Gate：

- 文件接口不会因同 Soul 存在多个 Bindings 而选错 Home；
- HTTP locator 不增加临时兼容字段；
- backend opaque ref 仍不暴露。

### Step 6：验证后端语义

1. 增加 Local same-Soul multi-Binding 测试。
2. 保留 E2B shared-workspace unsupported 测试。
3. 增加 backend 不按 Agent/Snapshot/config/Workspace 去重的契约断言。
4. 确认 Dify Agent 无 caller mapping、无数据库状态，production protocol shape 无需修改。
5. 运行相关 API/Dify Agent unit tests、migration test、Ruff 和类型检查。

Gate：

- Local 证明 Home 独立、Workspace 共享；
- E2B 明确 fail fast；
- 无 backend fallback 或 participant protocol 扩展。

### Step 7：更新架构文档

1. 更新 Agent Working Environment Architecture Doc。
2. 更新 Dify Agent runtime-resource 文档。
3. 删除 Agent ACTIVE unique、共享 Home 和 Agent-based Binding identity 表述。

Gate：

- 文档、schema、service 接口和测试使用同一 identity 模型。

## 18. 验收标准

- Binding ID 被定义并实现为 participant identity。
- Agent ID 只表示 Soul lineage。
- 同 Agent、同 Workspace 可以存在两个 ACTIVE Bindings。
- 两个 Bindings 不共享 Materialized Home、session 或 pending state。
- Binding 表不存在 `active_guard` 和 Agent ACTIVE unique index。
- Workspace 的 owner ACTIVE unique 约束保持。
- participant-specific 操作最终使用准确 Binding ID。
- Conversation、Build Draft 和 Workflow Node Execution 显式保存各自 Binding ID。
- Product Caller 是 Binding/Participant 的直接逻辑所有者；Agent 与 Workspace 分别只表达 lineage 和共享环境。
- Workspace owner scope 不能被用于解析 participant。
- Store 和文件接口不执行 0/1/多候选解析。
- Build Apply 使用准确 source Binding。
- Home Snapshot service 自己从 Build Draft pointer 解析 source Binding。
- retire 一个 participant 不影响同 Soul 的其他 participant。
- lifecycle sweep 可以按 Agent/App/Workspace 批量 retire，但不成为运行时 resolver。
- Local 支持同 Soul fork 后共享 Workspace。
- 后端把每个新 Binding ID 物化为独立 Home，不按 Agent/Workspace/generation 去重。
- Current E2B 对第二 Binding 明确返回 unsupported。
- Dify Agent backend protocol 不新增 participant 字段。
- Dify Agent 不保存 caller pointer 或 participant 映射。
- retention 队列和 collector 不消费 caller pointer。
- 没有 participant key/table、兼容代码、fallback 或过度生命周期设计。
