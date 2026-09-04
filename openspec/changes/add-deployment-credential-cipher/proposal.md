## Why

EE 的 deployment-owned credentials 没有可用的 deployment encryption key，现有 Tenant encryption API 又要求真实 `tenant_id`，因此无法在不伪造 Tenant owner 或复用通用 `SECRET_KEY` 的情况下安全持久化这类凭据。需要增加一条独立、可由编排层绑定的 deployment credential encryption 能力，同时保持现有 Tenant encryption 完全不变。

## What Changes

- 新增 deployment credential key 的创建与持久化生命周期，以稳定的 deployment identity 定位 key，并支持当前配置的 local 与 Azure Key Vault backend。
- 新增 `BoundCredentialCipher` 接口；调用方只接收已经绑定到整个 deployment 的 `encrypt` / `decrypt` 能力，不接触 deployment identity、key reference、storage path 或 Key Vault name。
- 提供编排层构造入口，用于解析 deployment key reference 并返回具体 cipher；本 change 不接入任何具体 deployment-owned credential consumer。
- 允许 edition-neutral 的基础设施创建 deployment key，但只有 EE deployment-owned 功能消费该 cipher。
- 对 key 尚未创建、key material 丢失和无效密文定义可预期的失败语义；decrypt 不得隐式创建或替换 key。
- 保持 Tenant key provider、Tenant credential ciphertext、`core.helper.encrypter`、`SystemEncrypter` 及其现有调用方不变；本 change 不迁移任何既有 credential。

## Capabilities

### New Capabilities

- `deployment-credential-encryption`: 定义 deployment credential key 的 provisioning、持久化、local/Azure cipher绑定及安全失败要求。

### Modified Capabilities

<!-- None. -->

## Impact

- 影响 `DifySetup` 持久化模型及数据库 migration，用于保存 deployment credential key 的 opaque reference。
- 影响 key-provider/infrastructure 层，增加 local storage 与 Azure Key Vault 下的 deployment key provisioning 和 bound cipher实现。
- 影响 application composition，增加 `BoundCredentialCipher` 的构造入口，但不改变现有业务 consumer。
- 不改变外部 HTTP API，不改变 Tenant encryption 行为，不要求现有 Tenant 或 system OAuth credential 数据迁移。
