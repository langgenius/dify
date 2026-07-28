## Why

IM control plane 已经具备 sync run、reconciliation、identity/binding 与 latest-result persistence，独立的 `implement-human-input-v2-im-provider-foundation` change 则统一拥有 Integration configuration、credential/client lifecycle 和 provider event transport。当前缺口是把 directory read 接到已有 reconciliation，并通过真实的 Dify application service 落地 manual sync 和 Contact binding；Sync 不应再复制 Foundation 的 Integration CRUD、connection test、provider client construction，也不应拥有由 `human-input-v2-api-contracts` 统一实现的 HTTP adapters。

## What Changes

- 依赖 `implement-human-input-v2-im-provider-foundation` 获取 current Integration revision、provider tenant 与 provider-local client lifecycle；本 change 不读取明文 credential，也不创建第二套 provider client factory。
- 增加 Sync-owned `IMDirectoryReader` 边界，为 Feishu、Lark 与 DingTalk 将 provider directory 数据归一化为 `ProviderDirectoryEntry`，不向 application/core 层泄漏 SDK model。
- 增加纯 Sync application service，统一编排 manual run creation、异步 directory fetch、`SyncReconciler` plan、revision-guarded apply、latest run 与结果分页。
- 落地同步结果到现有 Contact application boundary：搜索 synced IM identities、创建/删除 organization binding，以及设置/清除 workspace override。
- 保持 Dify 是所有 edition 的唯一 Sync owner；workspace 与 trusted internal API adapters 通过 transport-neutral composition entry point 复用同一个 service、worker、reconciler 与 repository boundary。
- 补齐 directory normalization、manual sync、unmatched 保留、binding 写入、stale revision 与并发触发等高风险路径测试。

## Capabilities

### New Capabilities

- `human-input-v2-im-sync-management-api`: 定义 Dify-owned manual sync implementation boundary、`IMDirectoryReader`、latest run/result query 与 reconciliation orchestration；不拥有 workspace/trusted internal HTTP transport。
- `human-input-v2-contact-im-binding-management-api`: 定义 synced IM identity 如何接入现有 Contact、organization binding、workspace override 与 effective-binding resolution。

### Modified Capabilities

- None.

## Impact

- Affected backend boundaries: `api/services/human_input_v2/*`, Sync-owned directory adapter packages, `api/core/human_input_v2/im_integration/*`, `api/repositories/human_input_v2/im_integration/*`, `api/repositories/human_input_v2/contact_directory/*`, and transport-neutral service composition modules.
- Affected tests: Sync service/worker、directory adapter contract、repository、binding resolution、consumer fixture 与 concurrency tests。
- Dependency: `implement-human-input-v2-im-provider-foundation` 必须先提供 current Integration view、provider tenant、safe errors 与 provider-local client factory。
- Excluded ownership: Integration read/configure/delete/test application logic、credential encryption/rotation、provider tenant confirmation、webhook/stream transport 与 card delivery/interaction 均不属于本 change；Pydantic DTO、workspace/internal handlers、authentication/scope/metadata mapping、HTTP error mapping、controller tests 与 501 replacement 由 `human-input-v2-api-contracts` 独占。
- Operations: 本 change 只支持 administrator-triggered manual sync；未来 directory-change event 可以复用 Foundation transport，但是否调度 sync 仍由后续 Sync-owned policy 决定。
