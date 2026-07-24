# Merge Main Agent Debug Conversation Lifecycle

## 1. 目标

将 `origin/main` 合入当前 Working Environment 分支，并以现有
`Binding.id = participant identity`、同步 `retire` / 异步 `collect`
模型为基线，吸收以下 main 变更的产品语义：

- `#39405`：隔离 Build 与 Preview 的聊天 Conversation；
- `#39415`：保证 workflow-only Agent 的 normal draft 不会长期停留在旧 Snapshot；
- `#39463`：Preview 未提供 Conversation ID 时开始新会话。

合并不得恢复旧的 conversation-scoped runtime-session lifecycle。实现只处理
main 合并、上述语义在当前架构中的落点及其直接测试，不扩展 Working
Environment 架构。

## 2. 架构基线

调试聊天涉及三个不同身份：

```text
AgentDebugConversation mapping = 当前编辑器在一个聊天 surface 上的 Conversation 指针
Conversation.id                 = 消息历史与 Preview product caller 身份
AgentWorkspaceBinding.id        = materialized participant、Home 与 Agenton session 身份
```

Build 与 Preview 的 participant owner 不同：

```text
Preview:
  Conversation.agent_workspace_binding_id -> Binding

Build:
  DEBUG_BUILD AgentConfigDraft.agent_workspace_binding_id -> Binding
```

因此：

- `AgentDebugConversation` 不拥有 runtime，不是外部资源状态；
- Conversation 隔离负责避免消息、parent chain 与 HITL 聊天上下文串线；
- Binding caller pointer 负责隔离 Materialized Home 与 Agenton session；
- Runtime Lease 仍然只存在于一次操作内；
- 资源退出继续使用数据库事务内同步 `retire`，commit 后投递异步 `collect`。

## 3. Conversation 数据模型

`agent_debug_conversations` 增加 `draft_type`，一条 row 表示一个编辑器在一个
surface 上的当前 Conversation：

```text
UNIQUE (
  tenant_id,
  agent_id,
  account_id,
  draft_type
)
```

支持的 surface 为：

- `draft`：Preview；
- `debug_build`：Build。

保留 main 已提供的 migration。既有 row 继续按其原有产品含义归入
`debug_build`。不得增加第二份兼容 migration、dual read/write 或 fallback。

`AgentDebugConversation` 只保存当前指针，不新增状态、Binding ID、runtime
字段或清理标记。

## 4. 产品行为

### 4.1 Build Conversation

Build 对一个 `(tenant, agent, account)` 使用稳定的 `debug_build` mapping：

- Agent detail/list 返回 Build Conversation；
- Build chat 未提供 Conversation ID 时使用当前 Build Conversation；
- 显式提供的 ID 必须等于当前 Build mapping，否则返回 not found；
- Build finalize 明确使用 Build Conversation；
- 现有无 body refresh endpoint 只表示“重启 Build chat”。

重启 Build chat 时：

1. 创建新的 Build Conversation；
2. 更新 Build mapping；
3. 查询当前账户的 `DEBUG_BUILD` Draft；
4. Draft pointer 非空时，按 Draft owner scope 精确校验并 retire Binding；
5. retire 成功后将 Draft pointer 设为 `NULL`；
6. 在同一数据库事务中提交 mapping、Binding 状态和 pointer；
7. commit 后异步 collect retired Binding。

如果 Build Draft 不存在或 pointer 为空，只旋转 Conversation。pointer 非空但
Binding missing、非 ACTIVE、owner 或 Agent 不匹配时 fail fast，不隐式清空或
创建替代 Binding。

### 4.2 Preview Conversation

Preview 使用独立的 `draft` mapping：

- 未提供、提供 `null` 或空 Conversation ID 时开始新 Preview Conversation；
- 显式提供当前 Preview Conversation ID 时继续该 Conversation；
- 显式提供旧 mapping、Build mapping、其他账户或其他 Agent 的 ID 时返回
  not found。

开始新 Preview Conversation 时：

1. 创建新的 Preview Conversation；
2. 读取旧 Preview mapping；
3. 旧 Conversation 有 exact Binding pointer 时，按 Conversation owner scope
   校验并 retire Binding；
4. 更新 Preview mapping；
5. 在同一数据库事务中提交 mapping 与 Binding 状态；
6. commit 后异步 collect retired Binding。

旧 Conversation 没有 Binding pointer 时不创建额外资源动作。pointer 非空但
Binding 无法精确校验时 fail fast。

### 4.3 明确的 Service 操作

产品操作不使用一个带 `draft_type` 分支的通用 refresh 方法。Service 暴露
含义明确的动作：

```text
get_or_create_build_conversation(...)
get_current_preview_conversation(...)
rotate_preview_conversation(...)
reset_build_conversation(...)
```

简单的 mapping 查询和创建可以使用私有共享 helper，但 Preview rotation 与
Build reset 保持为两个独立生命周期操作。

Console refresh endpoint 继续无 request body，并只调用
`reset_build_conversation(...)`。不公开 Preview refresh payload，也不为它扩展
OpenAPI contracts。

## 5. Binding 生命周期实现

不得恢复以下旧实现：

- 按 Conversation 扫描 runtime sessions；
- `AgentAppRuntimeSessionStore.list_active_sessions_for_conversation`；
- Agent backend session cleanup task；
- `backend_run_id`；
- cleanup payload 或 cleanup idempotency key；
- `mark_cleaned`；
- commit 后 best-effort 修改 runtime-session 账本。

Conversation rotation 只操作 Dify API 数据库中的 exact caller pointer 与
Binding 状态。物理资源删除仍由现有 retention queue 调用
`AgentWorkspaceService.collect_retired_binding`。

不得修改 Dify Agent backend protocol、Home Snapshot backend、
Execution Binding backend 或 Runtime Lease 接口。

## 6. Workflow-only Normal Draft 一致性

normal Preview draft 的解析统一进入 `AgentComposerService`，不再由
`AgentAppGenerator` 单独复制 draft 创建逻辑。

对于 `WORKFLOW_ONLY` Agent，normal draft 必须与当前 active config Snapshot
保持以下字段一致：

```text
base_snapshot_id = active snapshot id
home_snapshot_id = active snapshot home_snapshot_id
config_snapshot  = active snapshot config
updated_by       = current audit actor
```

一致性在两个位置保证：

1. `node_job_only` 更新 workflow-only Agent 的 active snapshot 后，主动更新已
   存在的 normal draft；
2. normal draft load/create 时检查并修复 stale row，保证读取路径自身维持
   invariant。

限制：

- 只 rebase `WORKFLOW_ONLY + DRAFT + account_id IS NULL`；
- Roster Agent 的 normal draft 用户编辑不得被覆盖；
- DEBUG_BUILD Draft 不参与 rebase；
- 不创建新 Home Snapshot，只引用 active config Snapshot 已有的
  `home_snapshot_id`；
- 保留当前 exact `draft_id` 查询，供 Build HITL resume 定位准确 Draft；
- active Snapshot 缺失时继续 fail fast，不创建空 Draft 或 fallback。

normal draft 不拥有 Binding，因此 rebase 不直接批量 retire Preview
Bindings，也不引入 draft revision、participant generation 或额外映射表。

## 7. Controller 与 API 契约

Agent chat controller 根据请求的 `draft_type` 选择具体操作：

```text
DEBUG_BUILD:
  resolve stable Build Conversation

DRAFT + no conversation_id:
  rotate Preview Conversation

DRAFT + explicit conversation_id:
  resolve current Preview Conversation and require exact match
```

Build finalization 始终走 Build resolver。

Agent detail/list 只读取或创建 Build mapping。现有字段
`debug_conversation_id` 的产品含义保持为 Build chat，不扩展为多 surface
响应。

main 中为 refresh endpoint 增加的 optional `draft_type` request body 不纳入
最终契约。相关 OpenAPI 与 generated contracts 必须通过仓库生成工具恢复为
无 body 形式，不得手工编辑 generated files。

## 8. Merge 与代码落点

实现必须使用真实 `git merge origin/main`，保留 merge 结果，不使用
cherry-pick 模拟。

已知需要重点处理的冲突与后续调整包括：

- `api/core/app/apps/agent_app/app_generator.py`
  - 吸收 normal draft 集中解析与 stale rebase；
  - 保留当前 `draft_id`、`home_snapshot_id` 和 fail-fast 行为。
- `api/services/agent/roster_service.py`
  - 吸收 surface-scoped mapping；
  - 用 Preview Conversation Binding retire 和 Build Draft Binding retire
    替代旧 runtime-session cleanup。
- `api/tests/unit_tests/services/agent/test_agent_services.py`
  - 保留 main 的产品行为测试；
  - 将 cleanup 断言改为 exact Binding retire/collect 断言。
- `api/tests/unit_tests/services/test_conversation_service.py`
  - 合并 SQLite session 测试结构与当前 Binding retirement 测试，不重复覆盖。

即使文件没有产生文本冲突，也必须检查并按本 proposal 调整：

- `api/models/agent.py`
- `api/controllers/console/agent/roster.py`
- `api/controllers/console/app/completion.py`
- `api/services/agent/composer_service.py`
- main 新增 migration、OpenAPI 与 generated contracts
- 对应 controller、generator 和 service 单元测试

不得顺带重构其他 Agent controller、Workspace service、session store、
retention worker 或前端状态管理。

## 9. 测试

测试聚焦以下行为：

### Conversation surface

- Build 与 Preview mapping 相互独立；
- Agent detail/list 始终使用 Build mapping；
- Build finalize 使用 Build mapping；
- Preview 无 ID 每次创建新 Conversation；
- Preview 显式当前 ID 可以继续；
- Preview 显式旧 ID 或 Build ID 被拒绝；
- Build 无 ID 继续稳定 Conversation；
- agent-id 与 backing-app-id chat 入口行为一致。

### Binding lifecycle

- Preview rotation retire 旧 Conversation 的 exact Binding；
- Preview rotation 不 retire Build Draft Binding；
- Build reset retire DEBUG_BUILD Draft 的 exact Binding 并清空 pointer；
- Build reset 不 retire Preview Conversation Binding；
- 无 Binding pointer 时 rotation/reset 不产生 collection；
- commit 失败时 mapping、retire 与 pointer 一起回滚且不 enqueue；
- commit 成功后只 enqueue 实际 retired Binding。

### Draft consistency

- workflow-only `node_job_only` 更新已有 normal draft；
- load normal draft 修复 stale workflow-only row；
- rebase 同时更新 `base_snapshot_id`、`home_snapshot_id` 与 config；
- Roster normal draft 编辑保持不变；
- DEBUG_BUILD Draft 不被 rebase；
- Build resume 继续按 exact `draft_id` 定位。

测试不得恢复旧 runtime-session cleanup doubles，也不得增加与本方案无关的
并发、GC、compatibility 或 backend integration 场景。

## 10. 实现步骤

1. 确认工作树，仅保留用户已有的无关未跟踪文件。
2. fetch 最新 `origin/main` 并执行 `git merge origin/main`。
3. 先解决四个文本冲突，确保当前 Binding/Home/Workspace 设计不被覆盖。
4. 调整自动合入但与最终设计不一致的 controller、model、composer、OpenAPI
   和 generated contracts。
5. 实现明确的 Build/Preview Conversation service 操作。
6. 用 exact Binding retire/collect 完成两个 surface 的资源生命周期。
7. 完成 workflow-only normal draft rebase，并同步 Home Snapshot ID。
8. 更新聚焦测试，删除旧 runtime cleanup 断言。
9. 运行冲突文件相关单元测试，再运行受影响 Agent controller/service/
   generator 测试、格式与静态检查。
10. 检查 merge 状态、未解决冲突、生成文件一致性和最终 diff，确保没有范围
    外改动。

## 11. 验收标准

- `origin/main` 已真实合入且不存在 unresolved conflicts；
- Build 与 Preview 消息和 participant 都不会相互复用；
- Preview 新会话、Build reset 与 Draft rebase 行为符合本 proposal；
- current Binding lifecycle 保持同步 retire / 异步 collect；
- 不存在旧 runtime-session cleanup 路径；
- refresh API 未新增 Preview request body；
- 没有 backend protocol、新状态机、fallback、兼容层或范围外重构；
- 聚焦测试与相关检查通过。
