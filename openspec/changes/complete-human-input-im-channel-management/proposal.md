## Why

当前 Channel Management 同时复制了 Email/IM aggregate、provider credential DTO、command 和 lifecycle orchestration，却没有隐藏两类 Channel 的配置差异。公开 API 又把 supported provider 当作 persisted Channel：读取某个未配置 provider 可以得到 `not_configured`，但对同一路径执行 PUT 可能替换另一个 provider 的 Integration。这个 shallow facade 造成 ownership 重复、resource identity 含混和 change amplification。

Channel 仍适合作为 Console 的统一术语，但这个统一只存在于 HTTP resource 与 credential-free response projection。Console transport 应直接调用 Email/IM 各自唯一的 owner，不因为对外 API 提供统一 collection 就创建对应的 cross-kind application service。

## What Changes

- 删除 Channel-level application facade 与 composition bundle；统一 configured-resource collection 和 available-provider catalog 只是 Console transport 对 Email/IM owner 读结果的聚合。
- 保留 Email Management 与 IM Integration application service 作为各自配置状态的唯一 owner；Console transport 直接调用对应 owner service，不按 provider 注册或分派 implementation。
- 将 persisted Channel collection 与 provider catalog 分开：唯一的 `GET /channels` 返回已配置资源，唯一的 `GET /channel-providers` 按 Email/IM 分组返回当前 deployment 可用的 provider，不返回 unavailable placeholder 或 availability state。
- 将 item route 改为 `/channels/<kind>/<channel_id>`。Provider 由 create/test request 的 discriminated configuration 选择，不再作为 persisted resource identity。
- 保持当前 effective `DirectoryScope` 最多一个 IM Channel。普通 `POST /channels/im` 在达到当前 cardinality 时返回 conflict；跨 provider 或 provider tenant 切换使用 `POST /channels/im/<channel_id>/replacement` 执行显式 atomic replacement。
- IM item update 只允许当前 provider 和 provider tenant 内的 credential rotation。Provider 或 provider tenant 变化是 resource replacement，不是隐式 PUT。
- **BREAKING**：canonical HTTP prefix 改为 `/console/api/workspace/current/human-input/v2`，并移除旧 `/console/api/workspaces/current/human-input/im-integration` 与 `/im-integration/test` configuration routes。IM sync、identity search 和 workspace override APIs 保持原路径。
- 将 `api/controllers/console/human_input_v2/providers.py` 定义为 Console provider credential DTO 的 canonical owner，并删除或迁移旧 controller transport DTO。所有 secret 字段使用 Pydantic `SecretStr`；create、update、replacement 和 test 都要求提交完整配置，不支持 `PreserveOriginalValue` 或 persisted-secret merge。
- 将 `ChannelSummary` 定义为 configured Channel 的 canonical transport projection；HTTP `ConfigVersion` 是 client-opaque string，底层 IM owner 仍使用完整的 `integration_id + numeric config_version` CAS。
- create、update 和 replacement 返回 `200` 与 `ChannelSummary`；delete 返回 `200` 与被删除的 `channel_id`。Configured Channel 只使用 `connected`、`invalid_credentials` 和 `connection_failure` 三种 status，并通过 `status_description` 提供安全说明。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `human-input-channel-management`: 仅在 Console transport 聚合 configured-resource 与 available-provider responses；所有读取和 command 直接委托 Email/IM owner，并保持当前单 IM transition。
- `human-input-channel-management-console-api`: 用统一 collection、ID-addressed item、ID-addressed replacement subresource 和独立 provider catalog 替换 provider-addressed Channel routes。
- `human-input-console-management-api`: 移除旧 `im-integration` management routes，同时保留 IM sync、identity search 和 workspace override routes。
- `human-input-email-channel-management`: 要求 Resend create/update/test 都提交包含新 API key 的完整 candidate，移除 API key retention。

## Impact

- Backend: Email/IM owner-native credential-free views、独立 production composition、Workspace Console resources/Pydantic contracts 和 backend tests；删除 `api/core/human_input_v2/channel_management/` cross-kind contracts。
- Removed implementation: `ChannelHandler`/registry、per-provider Channel managers、provider-addressed routes、旧 `im-integration` resources、旧 controller provider DTO 和重复 per-kind Channel summary DTO。
- Reused owners: existing Email Management aggregate/repository；existing IM Integration aggregate, adapters, complete CAS, identity/binding and sync invariants。Console transport DTO 由 `api/controllers/console/human_input_v2/` 独立拥有并映射到这些 application owners。
- Dependencies: consumes `implement-human-input-channel-management-api`; `integrate-im-contact-sync-runtime` continues to consume persisted IM Integration revisions. `implement-saas-slack-oauth` must extend the ID-addressed Channel surface rather than restore provider-addressed or legacy routes.
- Excluded: provider directory reconciliation、Celery dispatch、Slack OAuth lifecycle、frontend repository migration 和 EE transport。
