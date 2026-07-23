# Agent Working Environment 实现记录

## 状态

- 日期：2026-07-23
- 权威方案：`.context/proposals/260722-agent-working-environment.md`
- 范围：Dify API、Dify Agent、Agent App / Workflow runtime、Build Apply、Workspace 文件访问、Local / E2B backend
- 结果：五阶段实现审查全部通过；本地 E2B compose 栈已从当前分支重建并验证。

## 最终结果

原先由 `AgentRuntimeSession`、Home / Workspace / Sandbox layers 和 retained Sandbox locator 混合表达的运行环境，已经替换为四个职责独立的对象：

- `HomeSnapshot`：Agent-owned、不可变的 Home checkpoint。
- `Workspace`：产品 owner 持有的独立可变工作区。
- `AgentWorkspaceBinding`：一个 Agent 的 Materialized Home 与一个 Workspace 的持久关联。
- `RuntimeLease`：一次 Agent request、文件操作或 checkpoint 期间的临时执行能力。

Dify API 保存产品资源账本、owner、授权、生命周期状态和 backend opaque refs；Dify Agent 不连接产品数据库，只按部署选择的 backend 创建资源、acquire/release lease 和执行物理清理。

```text
HomeSnapshot --materialize--> AgentWorkspaceBinding --attach--> Workspace
                                   |
                                   +--acquire--> RuntimeLease --release--> end of operation
                                   |
                                   +--checkpoint Home--> new HomeSnapshot
```

Runtime Lease 不落库、不进入 Agenton session snapshot，也不决定 Workspace、Binding 或 HomeSnapshot 的产品生命周期。

## 主要实现

### 1. Dify API 资源账本

Alembic revision `f6e4c5686857`：

- 删除中间态 `agent_runtime_sessions` 表，不做 backfill、dual-read 或兼容迁移。
- 新增 `agent_workspaces`：保存产品 owner、`backend_workspace_ref`、ACTIVE / RETIRED 状态和未来 GC 所需的 `retired_at`。
- 新增 `agent_workspace_bindings`：保存 Agent、base HomeSnapshot、config version、Workspace、Agenton session snapshot 和 `backend_binding_ref`。
- 为 `agent_home_snapshots` 增加 ACTIVE / RETIRED 状态和 `retired_at`。

Workspace 的逻辑 owner key 是：

```text
(tenant_id, owner_type, owner_id, owner_scope_key)
```

`owner_type` 区分 `WORKFLOW_RUN`、`CONVERSATION` 和 `BUILD_DRAFT`。`active_guard=1` 只约束每个逻辑 owner 的单个 ACTIVE Workspace；retire 后置为 `NULL`，因此可以保留待 GC 的历史记录。

Binding 使用 `(tenant_id, workspace_id, agent_id, active_guard)` 保证同一 Agent 在同一 Workspace 中最多有一个 ACTIVE Binding。

### 2. API lifecycle services

`AgentHomeSnapshotService` 负责：

- backend-native initial Home 创建和 ledger 写入；
- Build Apply 从指定 Binding checkpoint Materialized Home；
- Agent retirement 时将 Snapshot 标为 RETIRED；
- 在无 Config Draft / Snapshot 引用时执行幂等物理删除，成功后删除 ledger row。

`AgentWorkspaceService` 负责：

- 创建第一个 Workspace + Binding，或在 backend 支持时把新 Binding 连接到现有 Workspace；
- 保存与恢复 Binding 上的 Agenton session snapshot；
- retire 单个 Binding、最后一个 Binding 对应的 Workspace，或一次 retire 整个 Workspace；
- 分别收集 RETIRED Binding 和 Workspace，物理清理成功后删除对应 row；失败时保留 row/ref 供未来 reconciler 接续。

所有 use-path 查询带 tenant、app、owner、Agent 和 ACTIVE scope。Agent App 文件浏览同时校验 account-owned normal conversation 或 account/Agent-owned debug conversation。

同一个 `AgentDebugConversation` 可以暂时拥有 normal draft 的 `CONVERSATION` Workspace 和隔离 build draft 的 `BUILD_DRAFT` Workspace。纯“当前 Workspace”入口从允许的 ACTIVE Binding 中按 Binding/Workspace `updated_at` 和 ID tie-breaker 稳定选择最新项；普通 conversation 永远不允许解析 Build Draft Workspace。

### 3. 创建补偿与事务边界

资源补偿采用局部 scope，而不向 legacy App / DSL / Snippet / Composer / Roster 调用链传播 transaction handle：

- 明确拥有 fresh session 的 Workspace/Binding create 和 Build Apply 使用局部 `resource_creation_transaction`。
- Initial Home 创建只在当前方法内覆盖物理创建和 ledger `flush()` 失败；该 scope 不 `begin()`、`commit()` 或 `rollback()` caller-owned session。
- 当前 scope 成功后，外层事务随后失败可能留下 backend orphan；本阶段明确交给未来 orphan reconciler，不用 ORM events、nested transaction 或不可靠的 rollback 推断模拟全局原子性。
- 补偿和 cleanup 都保留 primary error；次级 release/delete 失败不会覆盖原始异常。

### 4. Runtime 与 composition

Dify Agent 新增 `DifyRuntimeLayer`。它只接收 `backend_binding_ref`，在 layer startup acquire `RuntimeLease`，在 teardown release；Shell Layer 只消费 lease 暴露的 commands、files 和 layout。

Agent App 与 Workflow session store 现在保存持久 Binding identity 和 Agenton session snapshot，不再保存 Sandbox locator、runtime layer specs、`backend_run_id` 或 runtime-session cleanup intent。一次 run 的 `run_id` 只用于当前请求的事件、状态、取消与可观测性。

旧 Home / Workspace / Sandbox layers、`SandboxLocator`、session cleanup layer/task、`/sandbox/files/*` 和相关兼容测试已删除。

### 5. Dify Agent backend ports

Backend contract 收敛为两组资源接口：

```text
HomeSnapshotBackend
  initialize
  checkpoint
  delete

ExecutionBindingBackend
  create_binding
  acquire
  release
  destroy_binding
```

`RuntimeLease` 暴露 `layout.home_dir`、`layout.workspace_dir`、commands 和 files。`runtime_lease(...)` async context helper保证释放，并在 body 与 release 同时失败时保留 body 的主异常。

公开 server/client 同步改为 Home Snapshot、Execution Binding 和 `/workspace/files/*` API。Workspace file path 原样传给当前 RuntimeLease backend namespace；service 不做 Workspace-relative rebasing 或 `workspace_dir` containment。`~` / `~/...` 可以映射当前 Home，实际可访问范围由 backend isolation 决定。

### 6. Local backend

Local backend 物理分离：

- Snapshot 是不可变 Home 目录。
- Binding 拥有从 Snapshot 复制的 Materialized Home。
- Workspace 是独立目录；多个 Binding 可以引用同一个 Workspace。
- acquire 返回同时指向该 Binding Home 和共享 Workspace 的 RuntimeLease。
- Home checkpoint 只复制 Home，不包含 Workspace。
- `destroy_binding` 由 API 显式告知是否同时删除 Workspace。

多个 Materialized Home root 在共享 shellctl filesystem namespace 中物理可见；实际命令与文件访问由 shellctl/Landlock path isolation 限制到当前 lease 的 Home 和 Workspace。

### 7. E2B backend

当前 E2B backend 继续用一台 E2B Sandbox 物理承载一个 Binding、Materialized Home 和 Workspace：

- HomeSnapshot ref 是 E2B native Snapshot ID。
- `backend_binding_ref` 与 `backend_workspace_ref` 当前都可以是同一个 Sandbox ID，但仍是两个逻辑字段。
- acquire/release 对应 resume/pause Sandbox；产品层只看到 operation-scoped RuntimeLease。
- checkpoint 从当前 Binding Sandbox 创建 native Snapshot。
- E2B 收到 `existing_workspace_ref` 时 fail fast 返回 shared-workspace unsupported，不复制出伪共享 Workspace。

### 8. Retirement 与 collection

产品操作把 HomeSnapshot、Binding 或 Workspace 从 ACTIVE 转为 RETIRED；物理 collection 成功后删除 row，失败则保留 RETIRED row 和 backend ref。

同步删除/App retirement 在 commit 后调用一次 collection attempt。Workflow terminal path 是非阻塞边界：terminal layer 只向 Celery enqueue tenant/app/run stable IDs；task 使用 fresh session 执行 retire、commit、collect。enqueue 或 collection 失败不会覆盖 workflow 的成功/失败终态，重复任务可以继续收集已经 RETIRED 的记录。

本阶段没有定时 GC、TTL、资源年龄策略、复杂 retry 状态机或全局 orphan reconciler，但数据状态已为未来扫描留下入口。

### 9. Build Apply

Build Draft Apply 的 Home 流程为：

```text
Finalize build run
  -> browse current Build Workspace when needed
  -> resolve exact ACTIVE Build Binding
  -> acquire RuntimeLease
  -> checkpoint only Materialized Home
  -> create new AgentHomeSnapshot ledger row
  -> update Normal Draft.home_snapshot_id
  -> retire Build Workspace/Binding
  -> commit
  -> best-effort collect retired resources
```

缺失 Build Binding、owner 不匹配或 backend resource 丢失都会 fail fast；不回退到 initialize、其他 Binding、文件重放或兼容 locator。

## 相对 proposal 的有意偏差

### 1. Enterprise backend

Proposal 设计了完整 Enterprise Gateway adapter。本轮按最终实现范围只完整支持 Local 和当前 E2B；Enterprise profile 可以构造，但 HomeSnapshot/Binding 资源操作显式抛出 `NotImplementedError`，不提供 fallback。

### 2. 创建补偿范围

Proposal 倾向由 application service 拥有完整数据库事务，并在确定 rollback 时补偿外部资源。为避免把 `session.begin()` 和 compensation handle 扩散到既有多层调用链，最终只在 fresh-session owner 使用完整局部 transaction；Initial Home 只保证当前方法内创建 + flush 失败补偿。外层随后失败产生的 orphan 是已知边界，留给未来 reconciler。

### 3. Workflow retirement

Proposal 写成产品 use case commit 后直接 retire/collect，且不增加独立 cleanup task。最终 workflow terminal 使用 Celery task 异步执行 retire、commit、collect，因为该动作不阻塞 workflow 终态，并让 task 成为明确的 fresh-session transaction owner。

### 4. Local sibling Home 可见性

Proposal 的隔离描述偏向 backend namespace 本身隐藏 sibling Home。实际 Local backend 共享 shellctl filesystem namespace，sibling Materialized Home roots 在物理 namespace 中可能可见；不可访问性由 shellctl/Landlock path isolation 提供。

## 主要删除

- `AgentRuntimeSession` model/table、`backend_run_id`、runtime-session lifecycle/cleanup。
- Home / Workspace / Sandbox layers 及其 configs、states 和 cleanup hooks。
- `SandboxLocator`、sandbox file service/routes、workspace path containment helper。
- create/resume/suspend/delete 作为产品资源生命周期的旧 backend contract。
- 当前中间版本的 fallback、兼容 alias、旧 route、dual read/write 与兼容性测试。
- Enterprise backend 的伪实现；未支持的资源动作现在直接失败。

## 验证

五阶段独立审查全部 PASS：实现完整性、代码/逻辑卫生、测试充分性、测试卫生、注释与公开文档。

- 较宽 Dify API 聚焦回归：`458 passed, 2 warnings`。
- Dify Agent RuntimeLease、Local/E2B backend、RuntimeLayer 与资源 services：`25 passed`。
- Workspace/Binding 最终真实 SQLite 状态机测试：`13 passed`。
- 真实 E2B integration：`1 passed, 1 deselected`，覆盖 Home marker 写入、checkpoint、创建第二 Binding、从新 Home 读回 marker以及 runtime/snapshot cleanup。
- Migration test 实际执行 `f6e4c5686857` upgrade 并反射检查新表、列和索引。
- Dify Agent focused basedpyright：`0 errors, 0 warnings`。
- API 与 Dify Agent focused Ruff、`git diff --check`：通过。
- Dify Agent MkDocs build：成功。

## 本地 E2B compose 验证

已从当前分支重新构建 `dify-api:e2b-local` 与 `dify-agent-backend:e2b-local`，并用既有 project `dify-e2b-a35c`、既有环境和现有隔离 PostgreSQL volume 强制重建完整 compose 栈。数据库 volume 未删除。

- Alembic：`f6e4c5686857 (head)`。
- API、PostgreSQL、Redis、legacy sandbox health checks：healthy。
- Celery worker ready，Celery beat 正常调度；API/beat migration 均成功。
- 前端/API：`http://localhost:18080`，`/console/api/setup` 返回 `step=finished`。
- Dify Agent：`http://localhost:55050`，`/openapi.json` 返回 200。
- API 容器通过 `http://agent_backend:5050/openapi.json` 访问 Dify Agent 返回 200。
- Public Agent Stub endpoint：`https://dify-agent-dev.beautyyu.one/openapi.json` 返回 200。
- Runtime backend：`e2b`。
- E2B template：`difys-default-team/dify-agent-local-sandbox`。

第一次重建 nginx 时当前 shell 未携带原部署的 host port override，compose 尝试绑定已占用的 `:80`；随后以原部署值 `EXPOSE_NGINX_PORT=18080` 重新创建 nginx 并成功启动。没有修改 `.env` 或数据库。

## 当前实现入口

- API models：`api/models/agent.py`
- API migration：`api/migrations/versions/2026_07_23_0203-f6e4c5686857_replace_agent_runtime_sessions_with_.py`
- Home lifecycle：`api/services/agent/home_snapshot_service.py`
- Workspace/Binding lifecycle：`api/services/agent/workspace_service.py`
- Local compensation：`api/services/agent/resource_creation_compensation.py`
- Workflow retirement task：`api/tasks/retire_workflow_agents_task.py`
- Dify Agent protocols：`dify-agent/src/dify_agent/runtime_backend/protocols.py`
- RuntimeLease helper：`dify-agent/src/dify_agent/runtime_backend/leases.py`
- Runtime Layer：`dify-agent/src/dify_agent/layers/runtime/`
- Local / E2B / Enterprise adapters：`dify-agent/src/dify_agent/runtime_backend/`
- Execution Binding service/routes：`dify-agent/src/dify_agent/server/execution_bindings.py`、`server/routes/execution_bindings.py`
- Workspace file service/routes：`dify-agent/src/dify_agent/server/workspace_files.py`、`server/routes/workspace_files.py`
- 公开运行资源文档：`dify-agent/docs/dify-agent/concepts/runtime-resources/index.md`
