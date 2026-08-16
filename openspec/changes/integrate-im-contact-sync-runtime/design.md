## Context

Durable IM sync runs、reconciliation worker、provider-specific `IMProviderAdapter`、latest-only queries 和 binding apply 已存在。当前 Workspace trigger 直接调用 `IMSyncService.create_or_get_active_run`，缺少独立的 connected-channel eligibility boundary；默认 Cloud/self-hosted worker queue 也不包含 `human_input_contact_sync`。

Contact initialization 和 ongoing lifecycle 已拆给独立 Contact Directory changes。本 change 只让 backend runtime 从 authorized HTTP trigger 到 worker terminal persistence 可执行，并保持 sync 只消费 current Contact projection。

## Goals / Non-Goals

**Goals:**

- 建立 transport-neutral manual-sync facade 和 server-authoritative eligibility。
- 让 default workers 消费 dedicated sync queue。
- 保持 existing provider adapters 为 directory integration 唯一 owner。
- 验证 durable dispatch、redelivery、reconciliation 和 terminal persistence。
- 保持 latest-only API、stable errors 和 Contact read-only boundary。

**Non-Goals:**

- 不实现 Channel credential configuration 或 connected diagnostic persistence。
- 不创建、更新、删除、backfill 或 repair Contact。
- 不修改 reconciliation algorithm 或 IM identity schema。
- 不实现 scheduled/periodic sync、history API、OAuth 或 EE transport。

## Decisions

### 1. ManualIMSyncApplicationService owns trigger eligibility

新增 facade 接受 trusted `DirectoryScope` 与 actor facts，读取 current Integration 并验证 channel kind 为 IM、persisted status 为 connected，然后委托既有 `IMSyncService.create_or_get_active_run`。不满足条件时返回稳定 `im_sync_not_allowed`，且不创建 run、不 dispatch、不执行 provider I/O。

把 eligibility 留在 controller 会使未来 Workspace/EE transports 复制规则；把它放入 `IMSyncService` 会让低层 durable run/query service 同时拥有 Channel Management policy。因此使用独立 application facade。

### 2. Existing IMSyncService remains the durable run owner

Facade 不复制 single-active、revision capture、run-ID generation 或 dispatch recovery。`IMSyncService` 继续拥有 durable run creation/query；worker/repository 继续拥有 revision-guarded apply。这样 facade 接口较浅，复杂状态机保持在已有深模块中。

### 3. Provider directory reads stay in the worker adapter path

Worker 通过 `DifyIMProviderAdapterFactory` 构造 provider-specific `IMProviderAdapter`，并在 database transaction 外调用 `adapter.directory.read_directory()`。Controller、manual facade、Channel Management 和 repository 不能新增或直接调用 parallel directory client。

### 4. Reconciliation consumes current Contacts without repairing them

Provider directory 完整读取后，worker 在 guarded unit of work 中加载 current available Contacts、membership、identities 和 bindings，并立即 plan/apply。Input load 不能调用 initialization、ensure 或 lifecycle repair。缺失/不可用 Contact 是 current input fact，而不是 sync runtime 应修复的 error。

### 5. Dedicated queue membership is runtime correctness

保留 task routing `human_input_contact_sync`，并将 queue 加入 Cloud/self-hosted default lists。Custom `CELERY_QUEUES`/`CELERY_WORKER_QUEUES` 仍由 operator 明确控制，deployment guidance 必须说明启用 manual sync 时需要该 queue。不能静默改路到 workflow/notification queue。

### 6. Dispatch and redelivery preserve one logical run

Dispatch failure 可以留下 durable queued run并返回 sanitized unavailable error；下一次 create-or-get/queued recovery 复用同一 run。Terminal redelivery short-circuits，duplicate delivery 不重复 current-state mutation、change log 或 result facts。

## Risks / Trade-offs

- [Custom queue override omits sync] → 保持 queued state 可观测，提供 deployment diagnostics 和 repository-owned config tests，不使用 unrelated queue 兜底。
- [Provider I/O succeeds but Integration revision changes] → Apply 使用 captured revision guard，将 stale run 终止且不修改 current state。
- [Contact lifecycle is not ready] → code 可以合入但 rollout gate 保持关闭；sync runtime 不提供临时 backfill。

## Migration Plan

1. 完成 facade、controller mapping 和 architecture tests。
2. 将 dedicated queue 加入 default lists 与 deployment guidance。
3. 在 CI PostgreSQL/Redis integration 中验证 HTTP trigger、dispatch、worker、terminal persistence 和 redelivery。
4. 只有 Channel Management、Contact initialization 和 lifecycle maintenance ready 后才启用 production manual sync。
5. 回滚时关闭 trigger/capability gate；queued/terminal runs 保持可读，worker queue consumption 可以安全保留。

## Open Questions

无。
