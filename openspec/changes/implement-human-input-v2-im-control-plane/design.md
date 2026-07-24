## Context

当前 IM Integration、identity、binding 与 sync records 已存在于 `api/models/human_input_v2.py`，但 revision advancement、provider replacement、single-active-run、stale reconciliation 和 effective binding priority 尚未形成 domain API。它们共享 provider tenant identity 与 integration revision，若按配置、同步和 binding 的执行顺序拆成多个 service，会让同一决策泄漏到每一层。

本 change 在 Contact Directory 已提供 canonical Contact 与 snapshot contracts 后实施。

## Goals / Non-Goals

**Goals:**

- 将 IM configuration transition 封装到 `IMIntegration` aggregate。
- 将 sync matching 封装到 pure `SyncReconciler`，同时把 provider I/O 与 persistence apply 留在 application/repository layers。
- 保证完整 CAS、single active sync、idempotent retry 和 revision-guarded reconciliation。
- 向 recipient/submission consumers 暴露不含 credentials/ORM records 的 effective binding snapshot。
- 为 IM persistence records 提供独立 mapping、migration 和 concurrency evidence。

**Non-Goals:**

- 不实现真实 provider client、callback controller、Celery worker 或 secret encryption mechanism。
- 不自动创建 External Contact。
- 不实现 active-run timeout recovery、manual termination 或 sync generation。
- 不让 recipient resolver理解 provider credentials 或 raw directory payload。

## Decisions

### 1. Integration revision token 同时包含 identity 与 version

`IntegrationRevisionToken` 由 `integration_id + config_version` 构成。所有 existing integration update/delete 和 reconciliation apply 都必须携带完整 token。这样 provider replacement 产生新 integration identity 后，旧 token 不会因为 version 数值重用而发生 ABA。

Connectivity diagnostics 是非配置状态，不推进 config version。Credential rotation 与 provider/provider-tenant replacement 由 aggregate 返回显式 decision；replacement invalidates current identities/bindings，confirmed rotation preserves them。

### 2. Sync run 是独立 aggregate，reconciler 是纯模块

`IMSyncRun` 捕获启动时 integration revision。Application handler 负责 provider read/current snapshot I/O，`SyncReconciler` 只执行 provider-user-ID-first matching、normalized-email fallback 和 result classification，返回 immutable `ReconciliationPlan`。

Repository apply 前再次比较 current revision。Stale plan 只能追加 diagnostic result，不能更改 current identities/bindings。替代方案是让 reconciler直接操作 repository，但会混合 matching knowledge 与 transaction/locking。

### 3. Single-active-run 与 retry idempotency 在 persistence boundary 实现

创建 run 时 adapter 锁定 Integration row，检查 active run 并创建或返回 existing active state。同一 `sync_run_id` 的 apply 使用 stable idempotency identity；重复调用返回已有结果，不重复 current-state mutation。

### 4. Effective binding resolution 是 control-plane 的深接口

Resolution priority 固定为 workspace override、organization binding、Email fallback。Reset-to-global 删除/停用 workspace override 后重新暴露 organization binding。Integration/provider mismatch 返回 typed rejection，不把错误 binding 传给 recipient/submission consumers。

Consumer 只看到 Contact、Account、channel availability 与 proof 所需的 immutable facts，不看到 encrypted credentials、ORM identity record 或 provider raw payload。

### 5. Ports 按 CAS 和 reconciliation transaction 定义

Ports 提供 configuration CAS、Integration-locked active-run creation、current snapshot load、revision-guarded plan apply、effective binding snapshot 和 append-only sync results。不存在 table-shaped generic repositories。

### 6. IM schema 使用独立 migration slice

本 change 审核并迁移 Integration、identity、binding、sync run/result tables。所有 records 通过 explicit mappers 与 domain objects 互转，logical relationships 使用 eager loading 且保持 `lazy="raise"`。

## Risks / Trade-offs

- [Integration row lock 降低同一 integration trigger 吞吐] → 同一 integration 本就要求 single active run；不同 integrations 可并行。
- [Stale reconciliation 仍保存 diagnostic facts] → Result 明确标记 stale，且 adapter 保证券 current state 不被修改。
- [Provider replacement cleanup 涉及多表] → 一个 CAS adapter operation 拥有完整 transaction 与 rollback。
- [SQLite 无法证明目标并发语义] → 单元/contract tests 验证 decision 与 SQL shape，PostgreSQL CI tests 验证 row locking/CAS。

## Migration Plan

1. 添加 revision、integration、sync 和 binding domain tests/objects。
2. 添加 explicit mappers 与 repository contract tests。
3. 添加 IM tables migration 和 SQLAlchemy adapter。
4. 运行 targeted domain/repository tests、PostgreSQL CI suite、lint 和 type checking。
5. 回滚时停止 sync triggers，再 downgrade IM revision；Contact Directory 数据保持不变。

## Open Questions

- Active-run timeout recovery 和 operator termination 留给后续 operational change。
