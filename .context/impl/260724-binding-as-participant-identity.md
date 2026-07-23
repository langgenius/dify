# Binding as Agent Participant Identity 实现记录

## 状态

- 日期：2026-07-24
- 状态：已完成
- Proposal：`.context/proposals/260723-binding-as-participant-identity.md`
- 分支：`yanli/refactor-sandbox-and-e2b`
- 基线 commit：`35ca9c452c docs: define binding participant architecture`

## 最终结果

`AgentWorkspaceBinding.id` 现在是 Agent materialize 后产生的 participant identity，同时也是该 participant 的 Materialized Home 与 Agenton session identity。

```text
agent_id   = source Agent
binding.id = participant
             = Materialized Home
             = persisted Agenton session
```

同一个 Agent 可以在同一个 Workspace 中拥有多个 ACTIVE Bindings。每个 Binding 保存独立的 Home、session snapshot 和 HITL pending state；Bindings 之间只共享 Workspace。

产品代码不再通过 Agent、Workspace、generation、候选数量或更新时间推断 participant。Conversation、Build Draft 和 Workflow Node Execution 各自在自己的业务 row 上保存准确的 `agent_workspace_binding_id`，后续运行、文件访问、Build Apply、resume 和 retire 都从 caller pointer exact resolve。

## 数据模型

### Binding

`agent_workspace_bindings` 删除：

- `active_guard`；
- `(tenant_id, workspace_id, agent_id, active_guard)` unique index。

Binding 仅以主键 `id` 约束 participant identity。同一 tenant、Workspace 和 Agent 下可以存在多个 ACTIVE rows。

Workspace 自己的 `active_guard` 与 owner ACTIVE unique index 保留；本轮没有改变一个 owner scope 对应一个 ACTIVE Workspace 的语义。

### Caller pointer

以下业务表新增 nullable logical pointer，且不建立外键、lookup index 或 unique index：

- `conversations.agent_workspace_binding_id`；
- `agent_config_drafts.agent_workspace_binding_id`；
- `workflow_node_executions.agent_workspace_binding_id`。

pointer 为 null 表示 caller 尚未 materialize participant。首次创建时，Binding ledger 与 caller pointer 在同一数据库 transaction 中写入。pointer 非 null 时只能加载该 ID；missing、RETIRED、owner 不匹配或 generation 不匹配都 fail fast，不清空 pointer、不搜索替代 Binding，也不自动 rematerialize。

Migration 直接修改本分支的最终 Working Environment revision，不增加中间版本兼容 migration、pointer backfill 或 dual schema。

## Dify API 实现

### `AgentWorkspaceService`

Binding API 收敛为两个明确动作：

```text
create_binding(session, scope, agent_id, base_home_snapshot_id,
               agent_config_version_id, agent_config_version_kind)
    -> new Binding

get_active_binding(session, tenant_id, binding_id, expected_owner_scope)
    -> exact ACTIVE Binding?
```

删除 Agent/owner-scoped `resolve_active_binding`、`create_or_resolve_binding`、latest conversation Binding resolver 和面向运行路径的候选选择语义。

`create_binding` 每次创建新的 Binding identity，不自行 commit。调用方负责在同一 transaction 中写自己的 pointer。Backend 成功返回后发生数据库失败时不做 API-side 即时补偿，仍由未来 global reconciler 处理 orphan。

本轮没有增加 participant writer lock、创建幂等键或新的状态机。Build checkpoint 和 Workflow caller 加载也没有新增 `FOR UPDATE`；保留的锁只属于既有 retire 状态转换。

### Agent App

普通运行从 `Conversation.agent_workspace_binding_id` 取得 participant；Build 运行从 `DEBUG_BUILD AgentConfigDraft.agent_workspace_binding_id` 取得 participant。

`AgentAppSessionScope` 显式携带 `build_draft_id`：

- 无 `build_draft_id` 时，caller 是 Conversation；
- 有 `build_draft_id` 时，caller 是对应 DEBUG_BUILD Draft；
- build generation 缺失 Draft ID 会 fail fast。

Store 仍复用一个 `load_or_create` 入口，但不再按 generation kind、Agent 或最新 Workspace 推断 caller。Conversation ID 继续服务消息/HITL 运行上下文，Build Draft ID 单独决定 participant owner。

HITL resume 使用 `form_id` 精确定位持有 pending form 的 Build Binding，再恢复对应 Build Draft；不会从同 Agent 的其他 Binding 中选择。

### Workflow Agent Node

每个 `WorkflowNodeExecutionModel` 是 Workflow participant 的 Product Caller。Agent v2 node 的 caller row 在运行前同步写入 SQL，随后 session store：

1. 加载准确 node execution row；
2. pointer 为 null 时创建 Binding；
3. 同一 transaction 写入 `agent_workspace_binding_id` 和 `process_data.workflow_agent_binding_id`；
4. pointer 已存在时要求 config identity 已存在且精确匹配；
5. 缺失或冲突都 fail fast，不做 backfill。

两类 identity 已明确分开：

- `workflow_agent_binding_id`：`WorkflowAgentNodeBinding.id`，表示 Workflow config identity；
- `agent_workspace_binding_id` / runtime `binding_id`：Materialized participant identity。

Workflow persistence、SQL、Celery 和 LogStore 路径保留 `workflow_agent_binding_id`，避免 pause、retry、failure 或异步旧写覆盖 config identity。该 preservation 只保护已存在 identity，不猜测或补写历史缺失值。

### Build Draft 生命周期

Build Draft 使用 `BUILD_DRAFT / draft.id` 作为 Workspace owner。Apply、force checkout 和 discard 都从 Draft pointer 使用准确 Binding：

- Apply：Home Snapshot service 自己读取 Draft pointer、校验 owner/generation、checkpoint Materialized Home、更新 normal draft、retire source Binding；
- force checkout：校验并 retire 旧 Binding，显式重置 pointer；
- discard：校验并 retire 准确 Binding 后删除 Draft。

三个 endpoint 都由 service 持有 transaction，commit 成功后才 enqueue collection；controller 使用 read-only session wrapper，避免重复 transaction owner。

### Conversation 生命周期

Conversation 删除和 debug Conversation refresh 都读取 Conversation pointer，exact resolve 后同步 retire 该 Binding。仍有其他 ACTIVE Binding 时 Workspace 保持 ACTIVE；最后一个 Binding retire 时 Workspace 一并 retire。Commit 成功后才投递异步 collection。

Agent/App/Workspace 级批量 retire 仍可以按 Agent 或资源边界查询多个 Bindings，但这些集合查询只属于 lifecycle sweep，不暴露给运行、文件访问或 Build Apply。

## 文件访问与 Web caller

公共文件 API 不接受客户端 Binding ID 或 backend ref，只接受保存 pointer 的 caller identity：

- Agent App normal：`caller_type=conversation` + Conversation ID；
- Agent App build：`caller_type=build_draft` + Build Draft ID；
- Workflow：Workflow Node Execution ID。

Dify API 校验 tenant、app、account、caller、owner scope 与 ACTIVE Binding 后，才把 opaque `backend_binding_ref` 发送给 Dify Agent。

Web Working Directory source 改成 discriminated union。Build 页面直接使用 Build Draft ID；Workflow 页面使用 node execution ID。旧的 latest conversation/workflow-run 推断与 workflow run fallback 已删除，生成的 API contracts 已通过生成工具刷新。

## Dify Agent 与物理后端

Dify Agent production protocol 未增加 participant 字段，也不保存 caller mapping：

- `ExecutionBindingCreateSpec.binding_id` 已经是 participant identity；
- `agent_id` 只是来源 Agent ID；
- 每个新的 Binding ID 都必须物化独立 Home；
- Workspace ref 只表达共享 Workspace。

Local contract 验证：

- 同 Agent、同 Snapshot、同 config、同 Workspace 可以创建 B1/B2；
- B1/B2 的 Home 不同，Workspace 相同；
- binding-only destroy B1 后，B2 Home 和共享 Workspace 仍可用。

Current E2B 仍把 Binding、Materialized Home 与 Workspace 物理耦合在一个 Sandbox 中。传入 `existing_workspace_ref` 创建第二 Binding 时明确返回 `shared_workspace_unsupported`；control plane 不创建 fallback Sandbox/Workspace，也不回退 Local。

## 生命周期

Binding 状态保持：

```text
ACTIVE -> RETIRED -> row deleted
```

Caller pointer 不是资源状态机：

```text
null -> Binding ID
Binding ID -- explicit product reset --> null
```

Runtime Lease 仍是 operation-scoped，不落库。Request 结束只 release Lease，不 retire participant。Caller 结束或显式 reset 同步 retire；物理 collection 继续由 `retention` queue 异步执行。Collector 不读取、不清空 caller pointer。

## 审查中删除的过度设计

实现审查明确删除：

- `get_active_binding(for_update=...)` 与 Workflow caller-row 新增锁；
- existing Workflow pointer 缺失 config identity 时的自动 backfill；
- Build Apply controller 与 service 的双 transaction owner；
- normal Conversation unavailable pointer 测试中的 missing/retired 伪参数化。

没有增加 participant table/key、Materialized Home table、compatibility alias、candidate resolver、fallback、并发协调、TTL/GC 状态或 backend protocol 扩展。

## 与 Proposal 的实现差异

Proposal 用两个示意接口描述 Agent App normal/build store。实际代码保留一个 `load_or_create` 方法和一个显式 `build_draft_id` 字段，因为 Conversation 仍是 Build chat 的消息/HITL 上下文；participant owner 的选择只由是否提供准确 Build Draft ID 决定，不再依赖 generation 推断或候选查询。

除此之外没有架构性偏离。

## 验证

cmd-impl 五阶段审查全部通过：

1. 实现正确性：PASS；
2. 代码与逻辑卫生：PASS；
3. 测试充分性：补齐 exact stale pointer、Conversation retire、Local 多 participant 和 E2B no-fallback 后 PASS；
4. 测试卫生：删除伪参数化并修正三个不符合真实 model contract 的 test doubles 后 PASS；
5. 代码说明准确性：修正 Agent 身份与文件 caller docstring 后 PASS。

最终代表性验证：

- Dify API caller、lifecycle、Workflow persistence、migration 与 controller 聚焦套件：`350 passed, 2 warnings`；
- Dify Agent Local/E2B backend contract：`15 passed`；
- Web Working Directory 与 Workflow Agent panel：`20 passed`；
- Web TypeScript：通过；
- changed API Python（generated migration 除外）Ruff：通过；
- Dify Agent changed tests Ruff：通过；
- generated Alembic migration 的真实 upgrade/schema test：通过；
- `git diff --check`：通过。

Alembic 自动生成 revision 仍有 generator 产生的 import/line-length Ruff 基线；按仓库规则未手工修改 generated migration。

## 工作树

本轮实现、impl note 和最终文档尚未 commit 或 push。`dify-agent/.pdm-python` 是实现前已有的本机未跟踪文件，本轮未修改，也不会纳入提交。
