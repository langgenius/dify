## Why

IM reconciliation worker、latest-only Console queries 和 durable run model 已存在，但 manual trigger 仍未通过独立 eligibility facade 收敛，默认 worker 也不消费 `human_input_contact_sync` queue。生产 runtime 因此无法保证 connected IM Integration 从 HTTP trigger 到 terminal persistence 的完整可执行链路。

## What Changes

- 增加 transport-neutral `ManualIMSyncApplicationService`，只编排 trusted scope、connected-IM eligibility、single-active run 和 dispatch。
- 对 absent、非 IM 或非 connected Integration 返回稳定 `im_sync_not_allowed`，并在 run creation、dispatch 和 provider I/O 前拒绝。
- Workspace sync controller 调用 manual-sync facade；latest run、latest result paging 和 identity search 继续复用现有 transport-neutral query services。
- worker 继续通过 `DifyIMProviderAdapterFactory` 构造现有 provider-specific `IMProviderAdapter` 并调用 `adapter.directory.read_directory()`；不得新增平行 directory integration。
- provider I/O 完成后，guarded reconciliation input load 只读取 current available Contacts/membership facts；sync path 不创建、更新、删除、backfill 或 repair Contact。
- 将 `human_input_contact_sync` 加入 Cloud/self-hosted 默认 worker queue，并更新 custom queue deployment guidance 与 configuration regression tests。
- 保持 stable run-ID idempotency、terminal redelivery short-circuit、queued recovery 和 latest-only result contract。

## Capabilities

### New Capabilities

- `contact-im-sync-runtime-integration`: 定义 manual-sync application boundary、server-authoritative eligibility、dedicated queue readiness、provider directory ownership和 HTTP-to-worker terminal persistence。

### Modified Capabilities

无。

## Impact

- Backend: manual-sync application service/composition、Workspace Console sync controller/error mapping、existing sync service/worker tests。
- Runtime: `api/docker/entrypoint.sh`、`docker/.env.example`、Celery routing/configuration tests 和 PostgreSQL/Redis CI integration。
- Dependencies: consumes `complete-human-input-im-channel-management`; production rollout additionally requires `initialize-human-input-contact-projection` and `implement-contact-projection-lifecycle-maintenance`, but sync runtime never invokes either lifecycle.
- Excluded: Contact lifecycle mutation、manual binding、OAuth 和 EE transport。
