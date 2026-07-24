## Context

`api/core/human_input_v2/entities.py` 当前主要暴露 enum 与 identifiers；Contact 的 owner/source 合法组合、workspace-relative type、External Contact admission 和 EE nullable-owner uniqueness 仍主要存在于 ORM constraint 与 docstring 中。后续 IM binding、recipient resolution 和 submission authorization 都需要相同的 current Contact facts，因此 Contact Directory 必须先提供一个简单且稳定的领域接口。

## Goals / Non-Goals

**Goals:**

- 用纯 Python domain objects 表达 canonical Contact identity 与 lifecycle。
- 将 immutable identity source 与 workspace-relative resolution 分离。
- 让调用方一次获取 tenant-scoped、request-scoped directory snapshot，而不是拼接 membership、allow-list 和 Contact queries。
- 将 owner predicates、nullable uniqueness、locking、mapping 和 rollback 复杂度下沉到 SQLAlchemy adapter。
- 保持旧 `core.human_input_v2.entities` imports 可用。

**Non-Goals:**

- 不实现 Contact controller、EE protobuf adapter 或 Contact UI。
- 不实现 recipient canonicalization、IM synchronization 或 form authorization。
- 不把 workspace list/detail query 强制建模为完整 aggregate load。

## Decisions

### 1. Contact 是 canonical identity，workspace type 是 policy result

`Contact` 只持有 immutable `identity_source`、owner reference、current name/Email facts 和 lifecycle behavior。`ContactDirectoryPolicy.resolve_for_workspace(...)` 根据 membership 与 Platform allow-list snapshot 计算 `WORKSPACE / PLATFORM / EXTERNAL / ABSENT`。

没有 `WorkspaceContact`、`PlatformContact` subclasses，也不把 resolution result 写回 Contact record。替代方案是持久化当前 Contact type，但同一 Organization Contact 在不同 workspace 可同时得到不同结果，该方案会制造重复状态与更新放大。

### 2. 共享包只承载真正跨上下文且拥有稳定语义的值对象

本 change 引入 typed IDs、`NormalizedEmail`、organization/workspace scope 和 timestamps，但不创建独立 shared-foundation change。共享值对象保持窄接口；Contact-specific owner/source invariants 留在 Contact Directory 内。

### 3. Directory snapshot 是一致读取结果，不是长期缓存

Repository 提供一次 tenant-scoped snapshot load，包含 canonical contacts、membership facts、Platform allow-list facts 和 current Account availability。Snapshot immutable 且只对当前 use case 有效；domain policy 不查询数据库。

Read-only list/detail 可以使用 dedicated projection，不要求重建所有 domain entities。

### 4. Persistence port 围绕 directory invariants

Port 提供 snapshot load、External Contact admission、Platform allow-list mutation 和 hard deletion 等原子操作，不为每张表暴露 CRUD。Adapter 使用完整 owner predicates、explicit eager loading 和 domain mappers，绝不返回 ORM instances。

### 5. EE Organization 与 External identity claim 共享可选 deployment owner lock

`tenant_id IS NULL` 时数据库 unique constraint 不能单独保证 normalized Email/account uniqueness，也不能表达 Organization Contact 与不同 workspace External Contact 之间的 Email 冲突。创建或更新 EE Organization Contact 必须锁定唯一的 `DifySetup` row；External admission 在该 row 存在时获取同一把锁，再执行冲突检查和写入。Organization 写会检查 deployment 内全部 External Email；External admission 仍只比较 owning workspace 与 deployment Organization identities，从而保持 CE/SaaS tenant isolation。该 row 是 deployment-wide Organization 边界中已经存在的稳定 owner，且不依赖后续 IM Integration 是否已配置。

External admission 不启用 operation snapshot 的 `REPEATABLE READ` override：当 deployment owner 存在时，lock 必须先被获取，等待者随后读取已提交的 winning identity。SaaS/CLOUD 没有 `DifySetup` row 时不存在 deployment-wide Organization identity，External admission 因此直接使用 tenant-scoped identity boundary。独立 `load_snapshot` 仍使用一致的 MVCC snapshot。

替代方案包括锁 IM Integration row、依赖 deployment edition 配置或引入 advisory lock。前者在未配置 IM 时不可用并造成跨上下文依赖；edition 配置会把 deployment policy 泄漏进 repository；后者需要数据库方言特定实现。若 setup row 不存在，Organization 写返回明确 infrastructure failure；External admission 则按 tenant-scoped SaaS 语义继续。

### 6. Contact schema 作为独立 migration slice

本 change 只迁移 `human_input_contacts` 与 `human_input_platform_contact_workspace_entries`，并更新相关 model docstrings、constraints、indexes 和 logical-reference comments。后续 changes 以独立 Alembic revisions 添加 IM 与 form tables，避免一个 migration 同时承载多个 bounded context 的设计决策。

## Risks / Trade-offs

- [显式 domain/record mapping 增加代码] → 只在 Contact aggregate boundary 映射，并用双向 mapping tests 防止漂移。
- [锁定 deployment setup row 会串行化 Organization/External Email claims] → 仅 deployment owner 存在时的 identity admission 使用该锁；SaaS tenant-owned mutation 与读取不受影响。
- [Snapshot 可能在读取后立刻过时] → 明确 request-scoped snapshot semantics；需要 current authorization 的场景由 submission transaction 重新加载。
- [多个 migration revisions 增加部署步骤] → 每个 revision 单一职责、严格 down-revision 顺序，并验证 downgrade 只移除本 change 的对象。

## Migration Plan

1. 添加 domain values、Contact entity/policy 与纯单元测试。
2. 审核 Contact ORM records，添加 mapper、repository contract tests 和 SQLAlchemy adapter。
3. 添加 Contact schema revision 与 metadata/downgrade tests。
4. 运行 Contact targeted tests、Human Input v1 regression、lint 和 type checking。
5. 回滚时先停止后续 dependent changes，再 downgrade 本 revision；当前尚无生产 route 使用新表。

## Open Questions

- 无。EE nullable-owner uniqueness 使用 `DifySetup` row 作为稳定 lock owner；缺少该 row 表示 External admission 只有 tenant-scoped SaaS identity 语义。
