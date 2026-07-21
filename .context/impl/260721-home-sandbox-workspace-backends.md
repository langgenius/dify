# Home、Workspace、Sandbox 与 Runtime Backend 重构：中间实现历史

## 状态

本文记录 2026-07-21 第一阶段分层重构完成时的实现边界，**不是当前 Home Snapshot 生命周期的最终实现报告**。

第一阶段建立的 Home / Workspace / Sandbox / Shell 分层、Runtime Backend Profile、retained Sandbox Workspace
以及 Dify Agent 无数据库边界仍然有效。随后 Home Snapshot 的产品身份、创建来源、Publish 和回收语义被
`.context/proposals/260721-agent-home-snapshot-lifecycle.md` 直接替代，并已按该 proposal 落入当前代码。

因此，阅读本文时应采用以下优先级：

1. Home Snapshot 的当前事实以 lifecycle proposal 和当前实现为准。
2. Workspace、Sandbox、Shell 与 backend profile 的基础边界可继续参考
   `.context/proposals/260720-home-sandbox-workspace-backends.md`。
3. 本文只解释第一阶段为何存在以及哪些结构被后续实现保留，不承诺中间协议或 schema 的兼容性。

## 1. 第一阶段保留下来的架构成果

- `workspace_id == runtime_session_id == AgentRuntimeSession.id`。
- Dify API 是跨请求产品状态 owner；Dify Agent 不连接 Dify 产品数据库。
- Dify Agent 接收 composition、previous session snapshot 与 request，执行一次请求并返回 next snapshot。
- Sandbox Layer 管理物理 Sandbox handle 与 invocation-local lease。
- Workspace Layer 表示 retained Sandbox 中的当前可变文件视图；`workspace_dir` 同时是 `temp_dir`。
- Shell Layer 只消费 commands、files 与 layout，不拥有 Home、Workspace 或 Sandbox 生命周期。
- 请求结束后可以按 Dify API 保存的 session locator 恢复 retained Sandbox，浏览当前最新 Workspace。
- Local、Enterprise、E2B 通过统一 Runtime Backend Profile 接入，并复用 shellctl 数据面。
- 第一阶段不实现独立 Workspace volume、资源年龄 TTL、reconciler 或复杂回收状态机。

这些结论描述分层与执行模型，不定义 Home Snapshot 的产品 ownership。

## 2. 已被替代的中间 Home 方案

第一阶段曾把 Home 直接附着于 config version，并让通用 create 流程构建物理 Home。该设计用于尽快验证
Layer/backend 解耦，但没有进入兼容承诺，后续已直接删除。

当前不再支持以下中间语义：

- Config Snapshot 直接保存 backend ref 或动态 Home 状态。
- Home 生命周期跟随单个 config version。
- Publish 创建或重新 materialize Home。
- Draft 通过 base/active Config Snapshot fallback 解析 Home。
- API 通过通用文件 payload 重建 Home。
- E2B Build Apply 创建另一个 builder 再重放内容。
- 删除 config version 触发 Home 删除。
- runtime session cleanup 删除 Home。

这些内容只属于历史中间实现，不能作为 route、DTO、数据库字段、driver method 或部署能力的依据。

## 3. 当前 Home Snapshot 最终事实

### 3.1 产品状态

Dify API 的 `agent_home_snapshots` 是 append-only Home ledger：

```text
agent_home_snapshots
  id
  tenant_id
  agent_id
  snapshot_ref
  created_at
```

`id` 是产品层 Home identity；`snapshot_ref` 是 backend opaque handle。Normal Draft、Build Draft 与 immutable
Config Snapshot 只保存 `home_snapshot_id`；runtime session scope 也用该 ID 区分 Home identity，而已持久化的
runtime layer specs 可以包含恢复执行所需、已验证且非敏感的 ref。runtime 与其他 use-path ref resolution 必须
验证完整的 tenant、Agent owner scope 与 ACTIVE Agent 状态；retirement 不受 ACTIVE use-path guard 限制，而是在
Agent 已归档后按 `tenant_id + agent_id` 读取该 Agent 的全部 ledger refs。

Dify Agent 不保存 `home_snapshot_id -> snapshot_ref` 映射，也不增加数据库或资源 catalog。

### 3.2 创建与 Publish

- Agent provisioning 调用 backend-native initialize，Dify API 将返回的 ref 写入新 ledger row。
- Build Draft save 只保存配置，不创建 Home。
- Build Draft Apply 必须定位该 Draft 的 retained Sandbox；Dify Agent 恢复这个准确 locator，从 live lease 创建
  Snapshot，再次 suspend source Sandbox。Apply 将新 ledger row 的 `home_snapshot_id` 写入 Normal Draft。
- Build Sandbox 缺失或 owner 不匹配时 fail fast，不回退到 initialize、文件重放、builder 或其他 session。
- Publish 只把 Normal Draft 的 `home_snapshot_id` 复制到新的 Config Snapshot，不调用 Home create。
- Restore 和其他 config version 路径只复用已经验证的 Home ID。

### 3.3 回收

Config Snapshot 不拥有 Home。删除版本、丢弃 Build Draft 或清理 runtime session 都不删除 Home。

Agent 归档/retirement 是第一阶段批量物理清理边界。Dify API 从 immutable ledger 读取该 Agent 的全部 opaque refs，
通过 one-shot Celery cleanup task 请求 Dify Agent 幂等删除物理资源；ledger rows 保持不变。当前没有复杂 retry、
cleanup 状态机、reconciler、age TTL 或 eventual deletion guarantee。

Workflow-only Agent 只有在不再被有效 draft/published binding 引用时才进入 retirement；roster Agent binding 不会成为
workflow retirement candidate。

## 4. 当前 E2B 语义

E2B profile 继续使用部署配置指定的 template，并以 E2B Snapshot ID 作为 opaque Home ref：

- initialize 可以使用 backend/template 的原生能力创建初始 Home；若内部需要临时 builder，其生命周期只属于
  initialize 实现。
- Build Apply 不使用统一 builder，也不由 API 写入文件；它直接 snapshot retained E2B Build Sandbox。
- runtime Sandbox 从解析后的 Home ref 创建，请求结束时 pause，后续执行和文件浏览按稳定 handle resume。
- runtime active timeout 的动作是 pause；该设置不是 retained Sandbox 或 immutable Snapshot 的年龄 TTL。

## 5. 当前实现位置

- 权威 lifecycle：`.context/proposals/260721-agent-home-snapshot-lifecycle.md`
- Dify API ledger/model：`api/models/agent.py`
- Dify API Home orchestration：`api/services/agent/home_snapshot_service.py`
- Build Apply / Publish：`api/services/agent/composer_service.py`
- Workflow Agent retirement：`api/services/agent/retirement_service.py`
- One-shot cleanup tasks：`api/tasks/agent_backend_session_cleanup_task.py`
- 最终 schema migration：`api/migrations/versions/2026_07_21_2251-2f39536b3feb_add_agent_home_snapshot_ledger.py`
- Dify Agent wire contract：`dify-agent/src/dify_agent/protocol/home_snapshot.py`
- Dify Agent Home service：`dify-agent/src/dify_agent/server/home_snapshots.py`
- Runtime backend drivers：`dify-agent/src/dify_agent/runtime_backend/`
- 当前公开运行资源文档：`dify-agent/docs/dify-agent/concepts/runtime-resources/index.md`

## 6. 历史验证说明

第一阶段曾通过 Local、Enterprise、E2B driver/layer、Workspace 浏览和 Compose 验证，证明分层和 retained Sandbox
方向可行。那些测试数量与部署状态只是当时 checkout 的一次性结果，不是当前 release gate 或持续支持声明。
当前实现应以当前分支测试、lifecycle proposal 验收标准和公开 runtime-resources 文档为准。

## 7. 结论

第一阶段真正留下的是清晰的资源边界：Dify API 管产品状态，Dify Agent 执行无状态物理操作，Sandbox 保存当前
Workspace，Shell 不管理资源生命周期。Home 的最终模型则是独立 ledger、`home_snapshot_id` 引用、initialize /
Build Apply from retained Sandbox、Publish reuse 与 Agent retirement；任何更早的 config-version-owned Home 描述均已
被替代。
