# Merge Main Agent Debug Conversation Lifecycle 实现记录

## 状态

- 日期：2026-07-24
- 状态：已完成
- Proposal：`.context/proposals/260724-merge-main-agent-debug-conversation-lifecycle.md`
- 分支：`yanli/refactor-sandbox-and-e2b`
- 合入 main：`302b50c4fb84f7e7d4637cac278d0ae019dd5ea6`

## 最终结果

当前分支已真实合入 `origin/main`，并以现有 Working Environment 架构解决
`#39405`、`#39415`、`#39463` 与 participant Binding 模型之间的冲突。

最终语义为：

```text
AgentDebugConversation = per-account / per-surface current Conversation pointer
Conversation            = Preview message history and product caller
DEBUG_BUILD Draft       = Build product caller
Binding.id              = materialized participant, Home and Agenton session
```

Build 与 Preview 的 Conversation、消息历史和 participant 均相互隔离。旧的
conversation-scoped runtime-session cleanup 没有恢复；资源仍由 Dify API
同步 retire，数据库 commit 后通过 retention queue 异步 collect。

## Main 合并

实现执行了真实 `git merge origin/main`，解决了四个文本冲突：

- `api/core/app/apps/agent_app/app_generator.py`
- `api/services/agent/roster_service.py`
- `api/tests/unit_tests/services/agent/test_agent_services.py`
- `api/tests/unit_tests/services/test_conversation_service.py`

main 的其他变更按正常 merge 保留。本实现只对 Agent debug Conversation、
Binding lifecycle、normal draft rebase 及其直接 contracts/tests 做了后续调整。

合并后的 Alembic 图最初有两个 head：

```text
f6e4c5686857
d2825e7b9c10
```

使用 Flask-Migrate 生成了无 DDL merge revision `03ee43bc7e52`：

```text
03ee43bc7e52
  <- f6e4c5686857
  <- d2825e7b9c10
```

最终迁移图只有一个 head。该 revision 只合并迁移拓扑，不增加 compatibility
schema 或重复的 `draft_type` DDL。

## Conversation 数据模型

`AgentDebugConversation` 采用：

```text
UNIQUE (tenant_id, agent_id, account_id, draft_type)
```

其中：

- `draft` 保存当前 Preview Conversation；
- `debug_build` 保存当前 Build Conversation。

该 row 只是 current pointer，不拥有 Binding 或 runtime。main migration 中既有
row 按原产品含义归入 `debug_build`，没有新增 dual read/write 或 fallback。

## Service 与产品流

### Build

Build 使用稳定的 Build mapping：

- Agent detail/list 返回 Build Conversation；
- Build chat 和 finalization 使用 Build Conversation；
- refresh endpoint 继续无 body，并只重启 Build chat。

`reset_build_conversation` 在一个数据库事务中：

1. 创建并切换 Build mapping；
2. 精确解析当前账户的 DEBUG_BUILD Draft Binding；
3. 同步 retire Draft-owned Binding；
4. 清空 Draft 的 Binding pointer；
5. commit 后 enqueue collection。

Build Draft 不存在或 pointer 为空时只切换 Conversation。非空但无法精确解析的
pointer fail fast。

### Preview

Preview 未提供、提供 `null` 或空 Conversation ID 时调用
`rotate_preview_conversation`：

1. 创建新的 Preview Conversation；
2. 精确解析旧 Preview Conversation-owned Binding；
3. 同步 retire Binding；
4. 切换 Preview mapping；
5. commit 后 enqueue collection。

显式提供当前 Preview ID 时继续该 Conversation；旧 Preview ID、Build ID 或
其他 owner 的 ID 被拒绝。

Build reset 与 Preview rotation 是两个明确的 lifecycle operation。它们只共享
私有 mapping/create helper，没有形成带复杂分支的通用 refresh abstraction。

## Normal Draft 一致性

normal Preview draft 的解析统一进入 `AgentComposerService`。

对于 stale 的 `WORKFLOW_ONLY + DRAFT + account_id IS NULL` row，主动保存路径
和读取路径都会同步 active config Snapshot 的：

```text
base_snapshot_id
home_snapshot_id
config_snapshot
updated_by
```

Roster normal draft 与 DEBUG_BUILD Draft 不参与 rebase。实现保留了当前
`draft_id` 精确过滤，Build HITL resume 仍只解析指定 Draft；active Snapshot
缺失时继续 fail fast。

## 删除与拒绝恢复的实现

本轮没有恢复：

- conversation-scoped runtime session 查询；
- Agent backend session cleanup task；
- `backend_run_id` cleanup identity；
- cleanup payload / idempotency key；
- `mark_cleaned` 或 CLEANED runtime-session 状态；
- commit 后 best-effort runtime-session ledger 修改；
- refresh endpoint 的 Preview request body；
- Dify Agent backend protocol 或 Runtime Lease 变更。

container integration tests 中残留的旧 runtime-session imports、fixtures、
cleanup task patches 和 `mark_cleaned` assertions 已删除；Conversation
delete、ownership、rollback 和 related-data assertions 保留。

## Contracts

Console refresh endpoint 保持无 request body、Build-only。OpenAPI Markdown 与
generated contracts 通过仓库生成工具更新，没有手工编辑 generated files。

## 与 Proposal 的实现差异

业务设计与 Proposal 一致。实现过程中只有两项由真实 merge 状态触发的补充：

1. 生成无 DDL Alembic merge revision，收敛 main 与 Working Environment 的两个
   migration heads；
2. 清理 container integration test 中已删除 runtime-session lifecycle 的残留，
   使测试文件重新可以 collection。

两项都属于完成 main 合并和删除旧 cleanup 形状所必需的机械工作，没有扩展
产品架构。

## Review Loop

Eden 五阶段审查全部 PASS。采纳的反馈均在 Proposal 范围内：

1. implementation correctness：修复 Alembic multiple heads；
2. code/logic hygiene：用 Ruff 自动清理生成 migration 的无用 imports；
3. tests sufficiency：补 Build reset commit failure 与 exact Build `draft_id`
   两个测试；
4. test hygiene：删除无法 collection 的旧 runtime-session integration test
   residue；
5. notes/docs：补充 mapping ownership、Preview/Build retire 边界和 normal draft
   rebase invariant。

没有采纳或产生范围外重构。

## 验证

- 无 unresolved merge conflicts；
- Alembic heads：仅 `03ee43bc7e52`；
- 聚焦 Python tests：`264 passed`；
- 新增的两个精确测试：`2 passed`；
- container integration test collect-only：`29 tests collected`；
- 保留的三个 Conversation 删除 integration tests：`3 passed`；
- contracts tests：`11 passed`；
- contracts type-check：通过；
- 目标 Python Ruff check/format：通过；
- generated merge migration Ruff：通过；
- `git diff --cached --check`：通过。

用户已有的未跟踪文件 `dify-agent/.pdm-python` 未修改，也不会纳入提交。
