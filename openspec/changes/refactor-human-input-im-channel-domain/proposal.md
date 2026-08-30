## Why

当前 `IMControlPlaneRepository` 同时暴露 IM configuration、Identity、Binding、Sync 与 Reconciliation persistence。Channel configuration 因此没有独立的 persistence contract，owner predicate、singleton serialization、configuration CAS 与 ORM mapping也无法单独验证。

本 change 只建立 IM Channel Repository。它定义最终 Channel row、owner slot、Repository Protocol、SQLAlchemy implementations 与 persistence failures，不定义调用 Repository 的业务流程。

## What Changes

- 新增 owner-free immutable `IMChannel`、`IMChannelId`、`WebhookId`、`IMChannelStatus` 与 Channel persistence errors。
- 新增统一 `IMChannelRepository` Protocol，只暴露 `get`、`create`、`update`、`replace` 与 `delete`。
- 新增 `WorkspaceIMChannelRepository` 与 `DeploymentIMChannelRepository`。两个 implementations 使用同一张 `human_input_im_channels` table，并共享相同 method outcomes。
- 使用 non-null `owner_key` 表示唯一 persistence slot：workspace Channel 使用 `workspace:<tenant_id>`，deployment Channel 使用 `deployment`。`UNIQUE(owner_key)` 必须收敛所有 supported database dialects 上的 concurrent create。
- Workspace Repository constructor 绑定 `TenantId` 与 configuring `AccountId`；Deployment Repository不接受 actor并持久化 `configured_by_account_id = NULL`。Operation methods 不接收 owner、scope、edition、actor 或 raw `owner_key`。
- 每个 owner-bound read、conditional update、replacement 与 delete 都必须包含 constructor-derived `owner_key`。Channel ID 只标识 resource，不单独授权跨 owner access。
- Create 只把 owner-key unique violation 转换为 `IMChannelAlreadyConfiguredError`。Update、replacement 与 delete 使用 `owner_key + channel_id + expected_config_version` conditional DML，并把 zero affected rows 转换为 `StaleIMChannelWriteError`。
- Replacement 在 caller transaction 中删除 current row并插入相同 owner slot 下的 replacement row。Repository不决定何时使用 update 或 replacement。
- Repository 直接接收已构造的 `IMChannel`。它不定义 candidate、Provider validation、permission checks、Provider tenant resolution、credential protection、Channel ID/version generation 或 status transition。
- Repository把 canonical `IMEncryptedCredentials` 当作 opaque value映射和持久化；它不接收 plaintext credentials，不 decrypt envelope，也不执行 Provider I/O。
- 每个 Channel row持久化 globally unique `webhook_id`，但本 change 不定义按 `webhook_id` 反向查询、owner recovery、Webhook ingress 或 runtime composition。
- Channel Repository只读写 `HumanInputIMChannel`，不读取或修改 Identity、Binding、Sync/Reconciliation、Contact、Inbox 或其他领域记录。
- Repository接收 caller-provided SQLAlchemy `Session`，可以 query、conditional DML 与 flush，但不得创建 Session、commit、rollback、begin nested transaction、构造 lock、执行 external I/O 或 dispatch task。
- Existing shared `IMProvider`、`TenantId` 与 `AccountId` 继续由 `core/human_input_v2/` 拥有。Channel persistence values、ports、mappers 与 SQLAlchemy implementations 位于 `repositories/human_input_v2/im_channel/`。

## Capabilities

### New Capabilities

- `human-input-v2-im-channel-repository`: 定义 IM Channel schema、owner-key singleton、owner-bound Repository Protocol、scalar CAS、persistence errors 与 caller-owned Session contract。

### Modified Capabilities

- `human-input-v2-tenant-ownership-model`: 将 private `owner_key` 明确为 IM Channel persistence 对普通 `tenant_id` owner column 的局部例外。

## Impact

- Repository contract：新增 Channel persistence values、Protocol、mappers 与 Workspace/Deployment SQLAlchemy implementations。
- ORM/migration：定义 `HumanInputIMChannel` / `human_input_im_channels`，使用 non-null unique `owner_key`、globally unique `webhook_id` 与 positive configuration version。
- Tests：覆盖 mapping、owner isolation、singleton concurrency、constraint classification、scalar CAS、replacement ABA、rollback 与 Repository import boundaries。
- Unchanged：Provider adapters、credential preparation、management services、controllers、Console/EE APIs、Webhook/runtime、Identity、Binding、Sync/Reconciliation、Inbox、delivery 与其他业务编排。
