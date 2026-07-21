# Agent Home Snapshot 资源账本与 Build Apply 生命周期实现

## 状态

- 日期：2026-07-21
- 权威方案：`.context/proposals/260721-agent-home-snapshot-lifecycle.md`
- 范围：Dify API、Dify Agent、Agent Composer、Agent App / Workflow runtime、Local / Enterprise / E2B backend
- 结果：五阶段实现审查全部通过；本文件描述替换上一版中间实现后的最终代码形态。

## 最终结果

Home Snapshot 已从 Config Snapshot 和 Shell Layer 的生命周期中拆出，成为 Dify API 拥有的独立、不可变资源。Dify API 通过 append-only `agent_home_snapshots` 账本保存产品身份到 backend opaque ref 的映射；Dify Agent 保持无数据库、无资源 catalog，只负责当前 backend 的物理创建和删除。

常规编辑流程现在只有一个 Home materialization 边界：Build Draft Apply 从该账号、该 Draft、该 base Home 对应的 retained Build Sandbox 创建新 Snapshot。Build Draft save 不创建 Snapshot，Publish 也不创建 Snapshot，只把 Normal Draft 已确认的 `home_snapshot_id` 复制到 immutable Config Snapshot。

```text
retained Build Sandbox --Apply--> AgentHomeSnapshot H2
                                    |
                                    +--> Normal Draft.home_snapshot_id = H2

Normal Draft --Publish--> Config Snapshot.home_snapshot_id = H2
```

## 相对上一版中间实现的主要增加

### 1. Dify API 资源账本

- 新增 `AgentHomeSnapshot` 和 `agent_home_snapshots` 表：`id`、`tenant_id`、`agent_id`、`snapshot_ref`、`created_at`。
- Draft、Config Snapshot、Runtime Session 保存 required `home_snapshot_id`。
- mutable Agent App runtime session identity 和 conversation unique index包含 `home_snapshot_id`；Normal Draft Apply 后不会恢复旧 Home 对应的 Sandbox。
- Workflow runtime 继续以 immutable Config Snapshot ID 作为 session identity，但 session row 显式记录该版本的 Home ID。
- owner-scoped runtime/use-path ref resolution 必须同时匹配 tenant、Agent 和 Home，并要求 Agent 为 ACTIVE。

最终 Alembic revision 是 `2f39536b3feb`。它从旧中间 revision 的 parent 直接生成最终 schema，不包含兼容列、backfill 或双读写。

### 2. 产品生命周期服务

- `AgentHomeSnapshotService.create_initial()` 为新 Agent、import、duplicate 和 workflow-only Agent 创建 backend-native 初始 Home，并在数据库事务回滚时 best-effort compensation delete。
- `create_for_build_apply()` 只接受准确的 retained Build Sandbox locator；source 丢失映射为明确 domain error，不回退到 initialize、其他 session 或文件重放。
- Build Apply 在一个数据库事务中写入 Home ledger row、更新 Normal Draft config/Home、删除 Build Draft，并在提交后清理旧 Build/Normal runtime session。
- Publish 在完整 owner scope 内验证 Home 后仅复制 `home_snapshot_id`；重复 Publish 不产生新的物理 Snapshot。
- Restore、save-version 等 Config Snapshot 路径显式继承所选来源的 Home ID。
- Duplicate 为 target Agent 初始化独立 Home，不跨 Agent 共享 source row 或 physical resource。

### 3. Agent retirement

- 新增 workflow-only Agent 的 unowned retirement 判定，覆盖 Draft binding 替换、published binding 替换、DSL replacement 和 Workflow App 删除。
- Roster Agent archive、Agent App 删除及 workflow-only retirement 在事务提交后调度 one-shot Celery cleanup。
- cleanup 在 Agent 已归档后按 `tenant_id + agent_id` 读取全部 ledger refs，并调用 Dify Agent 幂等删除物理 Home；ledger row 保留。
- 第一阶段不增加 TTL、引用计数、cleanup 状态机、Reconciler 或复杂资源回收。

### 4. Dify Agent control plane 与 backend ports

Dify Agent Home API 被收敛为三个明确动作：

```text
POST   /home-snapshots/initialize
POST   /home-snapshots/from-sandbox
DELETE /home-snapshots/{snapshot_ref}
```

- protocol/client 区分 backend-native initialize 与 retained-sandbox snapshot。
- `from-sandbox` 在验证 tenant/Agent/build-draft owner 后构造 compositor，恢复准确 source lease，调用 backend `create_from_sandbox()`，退出时 suspend source。
- Local backend 以新的 Home ID 创建独立不可变目录，并在部分复制失败或取消时清理目标目录。
- Enterprise backend 使用对应的 initialize/from-sandbox gateway contract。
- E2B Build Apply 对 retained E2B Sandbox 调用 native `create_snapshot()`；从 Snapshot 创建新 runtime Sandbox 后清空并重建 Workspace，避免 source Build Workspace 暴露为新 Workspace。

## 相对上一版中间实现的主要删除

- 删除 `AgentConfigSnapshot.home_snapshot_ref` / `home_snapshot_status` 及旧 revision `bcd96196b7cd`。
- 删除 Config-version-owned Home 生命周期和 per-version physical delete。
- 删除 `source_digest`、digest-derived ref、Home file source、config/skill ZIP、canonical manifest 以及通用 `create()` payload。
- 删除 `POST /home-snapshots` 旧 route、旧 client method 和旧 DTO，不保留 alias 或 adapter。
- 删除 Publish materialization、Apply builder Sandbox、`base_snapshot_id` Home fallback、active Config Snapshot fallback 和跨 driver fallback。
- 删除 Dify Agent 持久映射、数据库、TTL/GC/catalog 等设想。
- 不提供中间 schema、旧 runtime session 或旧 physical resource 的兼容、迁移、backfill 与兼容性测试。

## 失败与一致性语义

- Home row、owner、retained Build session、source Sandbox 或 backend operation 缺失时 fail fast。
- Apply 的 backend create 在数据库 commit 前完成；数据库失败后只执行一次 best-effort compensation delete，原失败不被吞掉。
- 初始化 Home 的事务回滚会触发 compensation；commit 后不会误删。
- Apply/Discard 的 runtime cleanup 在提交后执行，不把外部 cleanup 失败变成数据库事务的一部分。
- retirement delete 对 not-found 幂等；其他失败保留 owner/ref 日志并让 task 失败，人工重跑会再次处理整批 refs。

## 验证

实现循环完成五阶段独立审查：方案完整性、代码卫生、测试充分性、测试卫生、说明与文档均 PASS。

- Dify API 11-file lifecycle gate：334 passed，1 warning。
- Workflow publish 专项：9 passed。
- Dify Agent changed suites：85 passed，2 个既有环境相关 skip。
- Home schema、owner scope、Build Apply/Publish、retirement、runtime identity、transaction compensation、Local/Enterprise/E2B backend 均有正向和失败路径覆盖。
- Ruff 通过；`git diff --check` 通过。
- Dify Agent basedpyright：0 errors；保留 126 个既有 strict warnings。
- scoped API mypy 被 mypy 1.20.2 在 typeshed `zipimport.pyi` 的 internal error 阻塞，不是本次代码诊断。

## 本地 E2B 部署验证

已从当前分支重建 `dify-api:e2b-local` 与 `dify-agent-backend:e2b-local`，停止旧的 `dify-e2b-a35c` 容器，删除且只删除专用 volume `dify-e2b-a35c_dify_e2b_postgres_data`，再以既有环境配置启动完整 compose 栈。

- PostgreSQL 是新 volume；API 自动迁移到 `2f39536b3feb (head)`。
- 新库中的 `agent_home_snapshots` 只有 `id`、`tenant_id`、`agent_id`、`snapshot_ref`、`created_at`，均为 NOT NULL。
- API、PostgreSQL 和 legacy Dify sandbox health check 均健康；worker、beat、websocket、plugin daemon、Redis、Weaviate、Nginx、Web 和 SSRF proxy 均运行。
- 前端：`http://localhost:18080`；fresh database 的 `/console/api/setup` 返回 `step=not_started`。
- Dify Agent：`http://localhost:55050`；公网 `https://dify-agent-dev.beautyyu.one` 能路由到同一服务。
- API 内部仍通过 `http://agent_backend:5050` 调用 Dify Agent；远端 Shell/Agent Stub 使用 `https://dify-agent-dev.beautyyu.one`，不会把 compose DNS 名暴露给 E2B Sandbox。
- runtime backend 为 `e2b`，template 为 `difys-default-team/dify-agent-local-sandbox`，既有 E2B credential 已安全复用且未输出。

真实 E2B 验证完成并清理了所有测试资源：

1. 通过 HTTP `POST /home-snapshots/initialize` 创建初始 E2B Snapshot，并以新 DELETE contract 得到 204。
2. 从初始 Snapshot 创建 retained E2B Build Sandbox，同时写入 Home 文件和 Workspace 文件。
3. 对 source lease 执行 `create_from_sandbox()`，得到新的 immutable E2B Snapshot。
4. 从新 Snapshot 创建下一代 runtime Sandbox，确认 Home 文件内容保留、source Workspace 文件不存在。
5. suspend/delete 两个 runtime Sandbox，并删除两个 E2B Snapshot；cleanup 无错误。
