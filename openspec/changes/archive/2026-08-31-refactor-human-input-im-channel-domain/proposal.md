## Why

当前 `IMControlPlaneRepository` 同时暴露 IM configuration、Identity、Binding、Sync 与 Reconciliation persistence。Channel configuration 因此没有独立的 persistence contract，owner predicate、singleton serialization、configuration CAS 与 ORM mapping也无法单独验证。

本 change 只建立 IM Channel persistence ports。它定义最终 Channel row、owner slot、Reader/write Protocols、SQLAlchemy implementations 与两个稳定write conflicts，不定义调用这些ports的业务流程。

## What Changes

- 新增 owner-free immutable `IMChannel`、`IMChannelId`、`WebhookId`、`IMChannelStatus`、`IMChannelAlreadyConfiguredError` 与 `StaleIMChannelWriteError`。
- 新增只暴露 `get` 的 `IMChannelReader` Protocol，以及只暴露 `create`、`update`、`replace` 与 `delete` 的 `IMChannelWriter` Protocol。
- 新增无 actor 的 `WorkspaceIMChannelReader` 与 `DeploymentIMChannelReader`，以及 `WorkspaceIMChannelWriter` 与 `DeploymentIMChannelWriter`。所有 implementations 使用同一张 `human_input_im_channels` table，并共享 mapping 与 owner predicates。
- 使用 non-null `owner_key` 表示唯一 persistence slot：workspace Channel 使用 `workspace:<tenant_id>`，deployment Channel 使用 `deployment`。`UNIQUE(owner_key)` 必须收敛所有 supported database dialects 上的 concurrent create。
- Workspace Reader constructor只绑定 `TenantId`；Workspace Writer constructor绑定 `TenantId` 与 configuring `AccountId`。Deployment Reader与Writer都不接受 actor；Deployment Writer持久化 `configured_by_account_id = NULL`。Operation methods 不接收 owner、scope、edition、actor 或 raw `owner_key`。
- 每个 owner-bound read、conditional update、replacement 与 delete 都必须包含 constructor-derived `owner_key`。Channel ID 只标识 resource，不单独授权跨 owner access。
- Create 只把 owner-key unique violation 转换为 `IMChannelAlreadyConfiguredError`。Update、replacement 与 delete 使用 `owner_key + channel_id + expected_config_version` conditional DML，并把 zero affected rows 转换为 `StaleIMChannelWriteError`。Repository让其他SQLAlchemy、mapping、validation与integrity exceptions原样传播。
- Replacement 在 caller transaction 中删除 current row并插入相同 owner slot 下的 replacement row。Repository不决定何时使用 update 或 replacement。
- Repository 直接接收已构造的 `IMChannel`。它不定义 candidate、Provider validation、permission checks、Provider tenant resolution、credential protection、Channel ID/version generation 或 status transition。
- Repository把 canonical `IMEncryptedCredentials` 当作 opaque value映射和持久化；它不接收 plaintext credentials，不 decrypt envelope，也不执行 Provider I/O。
- 每个 Channel row持久化 globally unique `webhook_id`，但本 change 不定义按 `webhook_id` 反向查询、owner recovery、Webhook ingress 或 runtime composition。
- Channel persistence adapters只读写 `HumanInputIMChannel`，不读取或修改 Identity、Binding、Sync/Reconciliation、Contact、Inbox 或其他领域记录。
- Repository接收 caller-provided SQLAlchemy `Session`，可以 query、conditional DML 与 flush，但不得创建 Session、commit、rollback、begin nested transaction、构造 lock、执行 external I/O 或 dispatch task。
- Existing shared `IMProvider`、`TenantId` 与 `AccountId` 继续由 `core/human_input_v2/` 拥有。Channel persistence values、stable write conflicts、`IMChannelReader`与`IMChannelWriter`位于`repositories/human_input_v2/im_channel_repository.py`；SQLAlchemy implementations及其private mapping helpers位于`repositories/human_input_v2/sqlalchemy_im_channel_repository.py`，不创建独立mapper module。

## Capabilities

### New Capabilities

- `human-input-v2-im-channel-repository`: 定义 IM Channel schema、owner-key singleton、owner-bound Repository Protocol、scalar CAS、stable write conflicts 与 caller-owned Session contract。

### Modified Capabilities

- `human-input-v2-tenant-ownership-model`: 将 private `owner_key` 明确为 IM Channel persistence 对普通 `tenant_id` owner column 的局部例外。

## Impact

- Repository contract：新增 Channel persistence values、独立Reader/write Protocols，以及包含private mapping helpers的Workspace/Deployment SQLAlchemy implementations。
- ORM/migration：定义 `HumanInputIMChannel` / `human_input_im_channels`，使用 non-null unique `owner_key`、globally unique `webhook_id` 与 positive configuration version。
- Tests：覆盖 mapping、owner isolation、singleton concurrency、constraint classification、scalar CAS、replacement ABA 与 rollback。
- Unchanged：Provider adapters、credential preparation、management services、controllers、Console/EE APIs、Webhook/runtime、Identity、Binding、Sync/Reconciliation、Inbox、delivery 与其他业务编排。
