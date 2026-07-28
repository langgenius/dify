# Nullable Home Snapshot and Backend Default Home

## 1. 背景

当前 Agent 创建流程会立即调用 Dify Agent 创建一个空的 Home Snapshot，并把其逻辑
`home_snapshot_id` 写入首个 `AgentConfigSnapshot`。这使一个尚未运行、也没有 Home
内容需要保存的 Agent 在创建时就依赖外部 runtime backend，并产生一份没有产品价值的
物理快照。

同时，现有 Alembic revision `2f39536b3feb` 向已有的
`agent_config_drafts`、`agent_config_snapshots` 和
`agent_runtime_sessions` 直接添加 `nullable=False` 的
`home_snapshot_id`。只要这些表已有数据，数据库就无法为历史行构造合法值，migration
会在到达后续 revision 之前失败。

本方案让 Home Snapshot 成为真正按需产生的不可变 checkpoint：

- 创建 Agent 和配置版本时可以没有 Home Snapshot；
- 新建 Execution Binding 时，如果配置没有明确的 Home Snapshot，由物理后端物化其部署默认
  Home；
- 只有需要保存实际 Home 内容时，例如 Build Draft Apply，才创建
  `agent_home_snapshots` 记录和物理快照；
- Local、E2B 和 Enterprise 都必须支持“无明确 Home Snapshot”这一 Binding 创建方式。

## 2. 目标

1. `AgentConfigDraft.home_snapshot_id` 和
   `AgentConfigSnapshot.home_snapshot_id` 支持 `NULL`。
2. `AgentWorkspaceBinding.base_home_snapshot_id` 支持 `NULL`，准确记录该参与者是从 backend
   default Home 物化，而不是从某个逻辑 Home Snapshot 物化。
3. Agent 创建、导入、复制和 Workflow-only Agent 创建不再创建初始 Home Snapshot。
4. Execution Binding 协议显式支持 `home_snapshot_ref = null`。
5. 所有 runtime backend 都实现无 snapshot 的默认 Home 物化。
6. Build Draft Apply 保持现有 checkpoint 语义：从确切 Binding 创建不可变 Home Snapshot，
   并把新逻辑 id 写入 normal draft。
7. 修复 migration 链，使带有历史 Agent 数据的数据库可以从旧 revision 升级，并使已经执行过
   当前 head 的数据库收敛到 nullable schema。
8. Alembic 继续保持单一线性 head，不创建 merge revision。

## 3. 非目标

- 不创建“默认 Home Snapshot”逻辑记录或全局默认 snapshot id。
- 不用空字符串、固定 UUID 或其他 sentinel 代替 `NULL`。
- 不在首次运行时懒创建并持久化 `agent_home_snapshots` 记录。
- 不为无效、已退休或不属于当前 Agent 的非空 snapshot 自动回退到默认 Home。
- 不改变 RuntimeLease、Workspace、Binding 的既有所有权和 retire/collect 模型。
- 不解决跨 backend 的 snapshot 可移植性。
- 不在本方案中为 Enterprise Gateway 增加不可变 snapshot/checkpoint 能力；本方案只要求
  Enterprise 支持无 snapshot 的默认 Home Binding。

## 4. 核心语义

### 4.1 `NULL` 的含义

`home_snapshot_id = NULL` 表示该配置没有绑定任何逻辑 Home Snapshot。它不指向
`agent_home_snapshots`，也不产生可 retire 或 collect 的 snapshot 资源。

创建新 Binding 时：

- `home_snapshot_id is None`：Dify API 向 Dify Agent 传递
  `home_snapshot_ref=None`，backend 为该 Binding 创建独立、可变的部署默认 Home；
- `home_snapshot_id is not None`：Dify API 必须解析到当前 tenant、Agent 所拥有且状态为
  `ACTIVE` 的 `AgentHomeSnapshot`，并传递其准确 `snapshot_ref`；
- 非空 id 无法解析时直接失败，不回退到默认 Home。

### 4.2 默认 Home 不是不可变 snapshot

默认 Home 只在创建 Binding 时物化。Dify API 不为它写
`agent_home_snapshots`，Dify Agent 也不返回隐式 snapshot ref。

默认 Home 由部署配置决定，因此同一配置版本在不同时刻创建的新 Binding 可能看到不同版本的
backend default Home。这个行为是 `home_snapshot_id=NULL` 的明确语义。已经存在的 Binding
继续使用自己的 Materialized Home，不受后续 backend template 变化影响。

### 4.3 Binding generation

`AgentWorkspaceBinding.base_home_snapshot_id` 保存物化来源：

- 非空：来自该逻辑 Home Snapshot；
- `NULL`：来自 backend default Home。

generation 校验继续比较
`(base_home_snapshot_id, agent_config_version_id, agent_config_version_kind)`。
`None == None` 是有效匹配；`None` 与任意具体 snapshot id 不匹配。Binding 不会因为配置后来
获得 snapshot 而被隐式迁移或重新物化。

## 5. 数据模型

| 表/模型 | 字段 | 新类型 | 含义 |
| --- | --- | --- | --- |
| `agent_config_drafts` / `AgentConfigDraft` | `home_snapshot_id` | `str \| None`, nullable | Draft 可使用 backend default Home |
| `agent_config_snapshots` / `AgentConfigSnapshot` | `home_snapshot_id` | `str \| None`, nullable | 不可变配置版本可以不绑定 Home Snapshot |
| `agent_workspace_bindings` / `AgentWorkspaceBinding` | `base_home_snapshot_id` | `str \| None`, nullable | Binding 的 Home 来源；`NULL` 表示 backend default |

`agent_home_snapshots` 不变：

- 只有实际存在的不可变 Home checkpoint 才有记录；
- `snapshot_ref` 仍为非空；
- tenant、Agent、状态、retire 和 collect 语义不变。

不新增表、状态、外键或默认 snapshot 配置。

## 6. 生命周期与产品行为

### 6.1 Agent 创建、导入和复制

以下路径不再调用 `AgentHomeSnapshotService.create_initial()`：

- roster Agent 创建；
- Agent App backing Agent 创建；
- Composer 中补建 backing Agent；
- Workflow-only inline Agent 创建；
- DSL 导入或复制时创建目标 Agent/config snapshot。

这些路径仍然创建首个 `AgentConfigSnapshot` 和 revision，但
`home_snapshot_id=None`。创建 Agent 因而不再依赖 Dify Agent、E2B、Local shellctl 或
Enterprise Gateway。

从已有配置创建 Draft 时，原样继承其可空 `home_snapshot_id`。复制到另一个 Agent 时不共享
来源 Agent 所拥有的 Home Snapshot；目标配置使用 `None`，直到目标 Agent 自己产生 checkpoint。

### 6.2 Publish

Publish 允许 Draft 的 `home_snapshot_id` 为 `None`：

- `None` 可以原样写入新的 `AgentConfigSnapshot`；
- 非空时仍校验 snapshot 归属和 `ACTIVE` 状态；
- `validate_home_snapshot_binding()` 对 `None` 表示“无需校验逻辑 snapshot”，对非空值保持严格
  校验；
- draft 与 active version 的一致性判断直接比较可空值。

Publish 不创建新的 Home Snapshot，因为 Home 内容只在 Build 期间发生变化。

### 6.3 首次运行

Agent App conversation、preview、Build Draft 和 Workflow Agent node 在首次需要参与者时调用
`AgentWorkspaceService.create_binding()`：

1. 配置中的 `home_snapshot_id` 原样作为可空 `base_home_snapshot_id`；
2. 非空时解析 ledger row，空值时跳过 ledger 查询；
3. 发送可空 `home_snapshot_ref` 给 Dify Agent；
4. backend 创建 Materialized Home 和 Workspace；
5. Dify API 持久化 Binding，其中 `base_home_snapshot_id` 可以为 `NULL`。

后续运行只 acquire 已有 Binding，不重新解释默认 Home，也不隐式创建替代 Binding。

### 6.4 Build Draft Apply

Build Draft 可以从 `home_snapshot_id=None` 开始。其 Binding 的 Materialized Home 由 backend
default 初始化，Build 期间的所有 Home 修改都发生在该 Binding 中。

Apply 保持现有流程：

1. 通过 `agent_workspace_binding_id` 解析确切 Build participant；
2. generation 校验允许 `base_home_snapshot_id=None` 与 Draft 的
   `home_snapshot_id=None` 匹配；
3. `create_home_snapshot_from_binding` 从该 RuntimeLease 的当前 Home 创建物理 checkpoint；
4. Dify API 新建 `AgentHomeSnapshot` ledger row；
5. normal draft 的 `home_snapshot_id` 更新为新 ledger id；
6. Build Binding 按现有流程 retire，异步 collect。

因此，第一次真正需要不可变 Home 的动作仍然是 Build Draft Apply，而不是 Agent 创建或首次运行。

### 6.5 Retirement 和 collection

nullable 不引入新的资源：

- `NULL` 不参与 snapshot retirement；
- snapshot reference 查询自然忽略 `NULL`；
- 非空 snapshot 的 retire/collect 逻辑不变；
- Binding 和 Workspace 的 retire/collect 逻辑不变。

## 7. Dify API 服务与调用链

### 7.1 `AgentHomeSnapshotService`

删除 baseline initialization 能力：

- 删除 `create_initial()`；
- 删除仅为该方法服务的 `InitializeHomeSnapshotRequest` 调用；
- 保留 `create_for_build_apply()`、retire、collect 和 delete；
- `validate_home_snapshot_binding()` 接受 `str | None`，仅对非空值查询并校验 ledger。

不保留未使用的 initialization fallback。

### 7.2 `AgentWorkspaceService`

`create_binding()` 的 `base_home_snapshot_id` 改为 `str | None`：

- 非空时解析 `AgentHomeSnapshot.snapshot_ref`；
- `None` 时设置 `home_snapshot_ref=None`；
- 非空但不存在、归属错误或已退休时继续抛出
  `AgentWorkspaceNotFoundError`；
- 创建的 `AgentWorkspaceBinding.base_home_snapshot_id` 原样保存可空值。

`validate_binding_generation()` 的对应参数改为 `str | None`，继续做直接相等比较。

### 7.3 配置与 runtime caller

以下类型和 helper 接受并传递 `str | None`：

- Composer `_create_config_version()`、`_update_current_version()`、
  `_agent_soul_matches_active_config()`；
- Agent App `AgentAppRunner`、`AgentAppSessionScope` 和
  `AgentAppWorkspaceStore`；
- Workflow Agent `load_or_create_node_execution_session()`；
- 其他以 config draft/snapshot 为来源的 resolver 和 request builder。

调用链不得在中途把 `None` 替换成临时 UUID、空字符串或新建 snapshot。

## 8. Dify Agent 协议

### 8.1 Execution Binding request

`CreateExecutionBindingRequest.home_snapshot_ref` 和
`ExecutionBindingCreateSpec.home_snapshot_ref` 改为 `str | None`，默认 `None`：

- 请求字段缺失或 JSON `null` 都表示 backend default Home；
- 非空字符串表示必须精确物化该 backend snapshot ref；
- 空字符串继续作为非法输入拒绝。

`ExecutionBindingBackend.create_binding()` 的 protocol 文档明确要求：

1. `None` 时创建独立、可变、可供当前 Binding 使用的默认 Home；
2. 非空时必须从指定 snapshot 初始化；
3. 指定 snapshot 不可用时失败，不得回退；
4. backend default Home 不得隐式创建不可变 snapshot；
5. 失败返回前清理本次创建的局部物理资源，不损坏已有 Workspace。

### 8.2 删除 initialization 协议

默认 Home 已不需要先制作一个空 snapshot，因此删除：

- `InitializeHomeSnapshotSpec`；
- `HomeSnapshotBackend.initialize()`；
- `InitializeHomeSnapshotRequest`；
- `/home-snapshots/initialize` route/service；
- client 的同步和异步 `initialize_home_snapshot` 方法；
- Local/E2B/Enterprise 对应 initialization 实现和测试。

`HomeSnapshotBackend` 只保留从 RuntimeLease 创建 checkpoint 和删除 snapshot 两项职责。

## 9. 物理后端实现

### 9.1 Local

`LocalExecutionBindingBackend.create_binding()`：

- 有 `home_snapshot_ref`：保持当前行为，验证 snapshot 目录并复制到新的 per-Binding Home；
- 无 `home_snapshot_ref`：不访问 snapshot root，直接创建空的 per-Binding Home 目录；
- 两种路径都设置 Home/Workspace 权限，并保持 shared Workspace 语义；
- 创建失败时继续只清理本次新建的 Home，以及由本次请求新建的 Workspace。

删除 `LocalHomeSnapshotBackend.initialize()`。Build Apply 的
`create_from_runtime()` 和 snapshot delete 保持不变。

### 9.2 E2B

`E2BExecutionBindingBackend` 显式接收部署配置的 E2B template：

- 有 `home_snapshot_ref`：以该 snapshot ref 创建 Sandbox；
- 无 `home_snapshot_ref`：以配置的 `DIFY_AGENT_E2B_TEMPLATE` 创建 Sandbox；
- 不能找到显式 snapshot 时把 SDK 错误映射为 `BindingCreateError`，不尝试 template fallback；
- 两种路径都清理并重新创建 canonical Workspace，然后 pause 并返回 Sandbox id 作为 Binding 和
  Workspace ref。

template 从 `E2BHomeSnapshotBackend` 移到 Execution Binding backend，因为它现在只负责默认
Binding 的初始环境。删除 E2B 的临时 initialization Sandbox 流程；
`create_from_runtime()` 仍从 Build Binding 的 E2B Sandbox 创建 immutable snapshot。

### 9.3 Enterprise

Enterprise 必须实现无 snapshot 的 Binding 创建：

- `existing_workspace_ref` 非空时，在任何外部写入前继续 fail fast，因为当前 Gateway 不能附加共享
  Workspace；
- `home_snapshot_ref=None` 时调用既有 Gateway `POST /v1/sandboxes`，请求包含
  `tenantId`，不传 `template`，由 Gateway 选择部署默认 sandbox template；
- 创建后通过 shellctl proxy 确保 canonical Home 存在，并清理/创建空 Workspace；
- 关闭 operation-local transport，保留 Sandbox，返回 Sandbox id 同时作为 Binding 和
  Workspace ref；
- 初始化失败时 best-effort 删除本次新建的 Sandbox。

Enterprise Gateway 当前没有 immutable snapshot API。因此
`home_snapshot_ref` 非空时明确抛出 `BindingCreateError`，而不是忽略该值或回退到默认 Home；
`create_from_runtime()` 和 snapshot delete 仍保持显式不支持。这样 Enterprise 完整支持本方案要求的
无 snapshot 首次运行，同时不虚构 snapshot 能力。

## 10. Migration 方案

### 10.1 为什么不能只在 head 后加 nullable migration

如果保留 `2f39536b3feb` 中的 `nullable=False`，一个已有 config draft、config snapshot 或
runtime session 的数据库会在执行该 revision 时失败。Alembic 不可能跳过失败 revision 到达后面的
nullable migration。

因此必须修正前面的 migration 本身；仅新增后续 migration 不能解决旧数据库升级失败。

### 10.2 修正历史 revision

修正 `2f39536b3feb`：

- `agent_config_drafts.home_snapshot_id` 以 `nullable=True` 添加；
- `agent_config_snapshots.home_snapshot_id` 以 `nullable=True` 添加；
- 中间态 `agent_runtime_sessions.home_snapshot_id` 以 `nullable=True` 添加。

历史行保持 `NULL`，不伪造 ledger id，也不尝试在数据库 migration 中调用外部 backend 创建物理
snapshot。

修正 `f6e4c5686857`：

- 创建 `agent_workspace_bindings.base_home_snapshot_id` 时使用 `nullable=True`；
- downgrade 重建中间态 `agent_runtime_sessions.home_snapshot_id` 时也使用
  `nullable=True`。

这样从旧 schema 首次升级到 head 的路径不会在添加列时失败。

### 10.3 已执行旧 revision 的数据库

只修改 migration 文件不会重新执行已经记录在 `alembic_version` 中的 revision。为使已经运行到
`f6e4c5686857` 的数据库也获得 nullable schema，在当前 head 后生成一个新的线性 convergence
revision：

```text
... -> 6f5a9c2d8e1b -> 2f39536b3feb -> f6e4c5686857
    -> <new make_home_snapshot_references_nullable revision>
```

该 revision 将当前仍存在的三个字段 alter 为 nullable：

- `agent_config_drafts.home_snapshot_id`；
- `agent_config_snapshots.home_snapshot_id`；
- `agent_workspace_bindings.base_home_snapshot_id`。

它不处理已被 `f6e4c5686857` 删除的 `agent_runtime_sessions`。

对于使用已修正历史链的新数据库，这三个 alter 是 schema convergence；对于已经执行旧文件的
数据库，它们是真正的修复。该 convergence revision 的 downgrade 不重新引入 `NOT NULL`，因为
修正后的 down revision 本身已经定义 nullable schema，而且含有 `NULL` 的真实数据不能安全回退
为 `NOT NULL`。

migration 链保持一个 head，不创建 Alembic merge revision。

### 10.4 数据处理

不做 Home Snapshot backfill：

- 历史配置行的 `NULL` 直接表示 backend default Home；
- 已有非空值原样保留；
- `agent_home_snapshots` 现有记录不变；
- 不在 migration 中访问 Dify Agent 或任何外部 backend。

## 11. 错误语义

- `home_snapshot_id=None`：合法，选择 backend default Home。
- 非空逻辑 id 无 ledger row、tenant/Agent 不匹配或状态非 `ACTIVE`：Dify API fail fast。
- 非空 backend ref 不存在：backend 返回 Binding 创建失败，不回退。
- backend 无法创建默认 Home：返回 `BindingCreateError`，Dify API 不创建 Binding ledger row。
- Enterprise 收到非空 snapshot ref：明确不支持并 fail fast。
- 已有 Binding 丢失：保持现有 `BindingLostError`，不创建默认替代 Binding。

## 12. 测试方案

### 12.1 Migration

- 构造包含历史 `agent_config_drafts`、`agent_config_snapshots` 和
  `agent_runtime_sessions` 数据的 pre-`2f39536b3feb` schema，执行到 head 成功；
- 断言三个当前字段均 nullable，历史配置行的值为 `NULL`；
- 覆盖从旧 `f6e4c5686857` 形态执行 convergence revision；
- 在 PostgreSQL 和 MySQL migration CI 中确认唯一线性 head；
- 更新 migration unit test 中旧的 `nullable=False` fixture 和断言。

### 12.2 Dify API

- 各 Agent 创建/导入/复制路径不调用 Dify Agent，首个 config snapshot 的
  `home_snapshot_id is None`；
- Draft 和新 config version 正确继承 `None` 或具体 id；
- Publish 接受 `None`，非空 snapshot 仍严格校验；
- `AgentWorkspaceService.create_binding()` 在 `None` 时发送
  `home_snapshot_ref=None` 并持久化 nullable base id；
- 非空无效 snapshot 不回退；
- Agent App、Build Draft 和 Workflow node 调用链能携带 `None`；
- 从 default Home 建立的 Build Binding 在 Apply 后创建真实 snapshot，并把新 id 写入 normal
  draft。

### 12.3 Dify Agent

- protocol/client/server 正确接受字段缺失和 JSON `null`，拒绝空字符串；
- Local 的 default 路径创建空私有 Home，不读取或复制 snapshot；
- E2B 的 default 路径使用 configured template，显式路径使用 snapshot ref；
- E2B 显式 snapshot 失败不回退 template；
- Enterprise default 路径调用 Gateway 创建、初始化 layout 并返回 refs；
- Enterprise 显式 snapshot 和 shared Workspace 在外部写入前 fail fast；
- 各 backend 创建中途失败时清理本次局部资源；
- 删除 initialization endpoint、client 和 backend method 后不存在残留调用或测试。

## 13. 代码实现步骤

1. **调整模型与 Alembic**
   - 将三个当前 ORM 字段改为可空；
   - 修正 `2f39536b3feb` 和 `f6e4c5686857` 的 nullable 定义；
   - 使用 Alembic 生成 `f6e4c5686857` 之后的单一 convergence revision；
   - 补充带历史数据的 migration 测试并验证唯一 head。

2. **收敛 Home Snapshot 生命周期**
   - 删除 `AgentHomeSnapshotService.create_initial()`；
   - 让 snapshot validation 接受 `None`；
   - 保留并验证 Build Apply checkpoint、retire、collect 和 delete。

3. **修改 Agent 配置创建与复制**
   - 更新 roster、backing Agent、Composer、Workflow-only Agent 和 DSL import/clone；
   - 所有初始 config snapshot 使用 `home_snapshot_id=None`；
   - 将 config version/draft helper 及序列化相关类型改为可空；
   - Publish 和版本复制原样传播可空值。

4. **修改 Binding 与 product callers**
   - 更新 `AgentWorkspaceService.create_binding()` 和 generation validation；
   - 更新 Agent App runner/store、Workflow node store/resolver 及其测试；
   - 确保 `None` 只在 Binding 创建边界转换为 `home_snapshot_ref=None`。

5. **修改 Dify Agent 私有协议**
   - 将 Execution Binding request/spec 字段改为可空；
   - 更新 protocol implementer guidance；
   - 删除 initialize-home-snapshot DTO、client、route、service 和 backend protocol method；
   - 更新 exports 和调用测试。

6. **实现三个 backend 的 default Home**
   - Local 增加无 snapshot 的空 Home 分支；
   - E2B 将 template 注入 Execution Binding backend，并区分 template/default 与 snapshot；
   - Enterprise 基于既有 Gateway create API 实现 default Binding，显式 snapshot 保持 fail fast；
   - 更新 backend profile wiring 和集成测试。

7. **更新文档与生成产物**
   - 更新 Runtime Resources、Operations Guide、Get Started 和 Shell layer 文档；
   - 删除“Agent 创建先初始化 Home Snapshot”和“Enterprise Binding 全部未实现”的陈述；
   - 使用仓库生成工具刷新 API docs/前端契约等生成产物，不手工修改生成文件。

8. **验证**
   - 运行 API 相关 unit tests、strict type checks 和 migration SQL/heads 检查；
   - 运行 dify-agent format、lint、typecheck、Local/E2B/Enterprise tests；
   - 运行 PostgreSQL/MySQL migration CI；
   - 确认 Alembic 仍只有一个线性 head。

## 14. 完成标准

- 创建任何类型的 Agent 都不创建物理或逻辑 Home Snapshot。
- 无 Home Snapshot 的 Agent 可以在 Local、E2B 和 Enterprise 上创建并运行 Binding。
- 非空 snapshot 始终精确解析和物化，任何失败都不会回退。
- Build Draft Apply 可以从 default Home checkpoint 出真实 immutable Home Snapshot。
- 带历史 Agent 数据的数据库可以从 `2f39536b3feb` 之前升级到最新 head。
- 已执行旧 `f6e4c5686857` 的数据库也会被 convergence revision 修正。
- 当前三个 ORM 字段与数据库 schema 均为 nullable。
- migration 链单一线性，无 merge revision。
