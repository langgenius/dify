## 1. Manual Sync 契约与失败测试

- [ ] 1.1 盘点现有 Workspace trigger、`IMSyncService`、durable run repository、Celery task、provider adapter factory、reconciliation input load、latest-only queries 与 stable error mappings。
- [ ] 1.2 添加失败的 application-service tests，覆盖 connected IM eligibility，以及 absent、Email 或 non-connected channel 在 run creation、dispatch 或 provider I/O 前返回 `im_sync_not_allowed`。
- [ ] 1.3 添加 architecture tests，证明 controllers 不拥有 eligibility/repository/task orchestration，provider directory read 只使用既有 factory/adapter path，sync code 不能调用 Contact initialization 或 lifecycle mutation。
- [ ] 1.4 添加失败的 runtime tests，覆盖 run 持久化后的 dispatch failure、same-ID queued recovery、captured-revision guard、terminal redelivery 与 duplicate-delivery idempotency。

## 2. Transport-Neutral Manual Sync Facade

- [ ] 2.1 实现 `ManualIMSyncApplicationService`，组合 trusted `DirectoryScope`/actor facts、current Integration lookup、persisted connected-IM eligibility 与既有 `IMSyncService.create_or_get_active_run` boundary。
- [ ] 2.2 保持既有 durable-run owner 负责 single-active creation、captured revision、stable run ID、dispatch 与 recovery；dispatch failure 映射为 sanitized unavailable outcome，同时保留 queued run。
- [ ] 2.3 将 Workspace manual-sync controller 接到 facade，并限制为 authorization、trusted context construction、DTO mapping 与 stable error translation。
- [ ] 2.4 验证 latest run、paginated latest results 与 synchronized identity search 继续使用既有 transport-neutral query services，不增加 history 或 arbitrary run-by-ID semantics。

## 3. Provider Adapter 与 Contact 边界

- [ ] 3.1 添加 contract coverage，证明每个 managed IM provider 都通过 `DifyIMProviderAdapterFactory` 构造，并通过 `adapter.directory.read_directory()` 读取，eligibility 不按 provider name 分支。
- [ ] 3.2 保持 provider I/O 位于 database transaction 外；完成后立即加载 current eligible Contact、membership、identity 与 binding facts，再执行 guarded reconciliation plan/apply。
- [ ] 3.3 添加 Contact read-only regression coverage，证明 missing/unavailable projection 只是 input fact，不会触发 Contact create、update、delete、initialization、backfill 或 repair。
- [ ] 3.4 添加 worker coverage，覆盖 provider I/O 后 Integration revision 变化、guarded stale termination、terminal short-circuit，以及不重复 current-state、change-log 或 result-fact writes。

## 4. Dedicated Queue Readiness

- [ ] 4.1 将 `human_input_contact_sync` 加入 `api/docker/entrypoint.sh` 的 Cloud 与 self-hosted default queue lists，并保持 explicit custom queue overrides。
- [ ] 4.2 更新 maintained deployment guidance 与现有 custom queue examples，明确启用 manual IM Contact synchronization 时必须包含 `human_input_contact_sync`。
- [ ] 4.3 添加 configuration regression tests，覆盖 task routing、两套 default queue lists 与 maintained custom override examples。
- [ ] 4.4 为 deployment 未消费 dedicated queue 时的 queued run 增加 operational diagnostic 或等价可观测状态，禁止把任务改投 unrelated queue。

## 5. Runtime 集成与发布

- [ ] 5.1 添加 PostgreSQL/Redis integration coverage，覆盖 authorized Workspace trigger、durable dispatch、provider adapter directory read、guarded reconciliation、terminal persistence、latest-run/results reads 与 terminal redelivery。
- [ ] 5.2 使用 injected complete-directory adapters 添加 provider-set integration coverage，覆盖 Email rejection、connected-status eligibility、stale revision、automatic binding reconciliation 与 zero Contact mutation。
- [ ] 5.3 运行 focused backend unit suites、queue configuration tests、formatter、type/lint checks 与 `openspec validate integrate-im-contact-sync-runtime --strict`。
- [ ] 5.4 审计最终 dependency graph，确认只有一个 directory integration path、一个 durable run owner、一个 read-only Contact boundary，且 default deployment 消费 dedicated queue。
- [ ] 5.5 仅在 `complete-human-input-im-channel-management`、`initialize-human-input-contact-projection` 与 `implement-contact-projection-lifecycle-maintenance` 分别通过 rollout gate 后启用 manual sync；通过关闭 trigger gate 演练 rollback，同时保留 queued/terminal runs 可读。
