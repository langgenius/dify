## Context

当前 credential encryption 主路径以 `tenant_id` 为固定 owner：local provider 从 `Tenant.encrypt_public_key` 读取 RSA public key，并从 `privkeys/{tenant_id}/private.pem` 读取 private key；Azure provider 则从 `tenant_id` 推导 Key Vault key name。该接口无法表达没有 Tenant row 的 deployment owner。

仓库虽然存在基于通用 `SECRET_KEY` 的 `SystemEncrypter`，但它将持久化 credential 的可恢复性绑定到 session/signing key，没有独立的 provisioning、reference 或 rotation 生命周期。本 change 为 deployment-owned credential 建立独立能力，但不迁移 `SystemEncrypter` 的现有使用者。

deployment identity 使用 `DifySetup.instance_id`。`DifySetup` 增加 nullable opaque key reference，以便 schema migration 不触发外部 storage 或 Key Vault side effect。新安装可以在创建 `DifySetup` 时 provision；既有安装由显式 provisioning entry point 幂等补齐。

## Goals / Non-Goals

**Goals:**

- 提供只暴露字符串明文与二进制密文转换的 `BoundCredentialCipher`。
- 创建并持久化一个绑定到稳定 deployment identity 的 credential encryption key。
- 支持当前 `KEY_PROVIDER_TYPE` 的 local 与 Azure Key Vault backend。
- 将 deployment identity、key reference、storage path、Key Vault client 和 key lookup隐藏在 infrastructure/composition 内。
- 使 provisioning 可安全重试，并保证 cipher construction 与 decrypt 不会隐式生成或替换 key。
- 保持 key provisioning 本身 edition-neutral，供后续 EE composition消费。

**Non-Goals:**

- 不修改 Tenant key provisioning、`BaseKeyProvider` 的 Tenant contract、`core.helper.encrypter` 或 Tenant ciphertext。
- 不接入 Human Input、system OAuth 或其他具体 credential consumer。
- 不迁移 `SystemEncrypter` 或任何既有 credential row。
- 不引入通用 key registry、per-purpose keys、AAD contract、local key rotation或 provider migration。
- 不定义 Base64、JSON、Pydantic model 或其他 persistence envelope；这些属于后续 credential codec。

## Decisions

### 使用 bound runtime capability，而不是 owner-aware cipher API

新增的公共运行时接口为：

```python
class BoundCredentialCipher(Protocol):
    """Encrypt credentials within one pre-resolved ownership boundary."""

    def encrypt(self, plaintext: str) -> bytes: ...

    def decrypt(self, ciphertext: bytes) -> str: ...
```

接口不接受 `tenant_id`、`instance_id`、key reference 或 provider selector，也不暴露 provisioning、rotation、batch decoding context。编排层先解析 deployment boundary，再注入一个已绑定实例。这样 consumer 无法在 operation call 上选择或意外切换 owner，重复解密所需的 key/decoding cache也由具体 cipher内部吸收。

备选方案是在现有 `BaseKeyProvider` 上增加 `CredentialOwner` 参数。该方案会迫使所有 consumer理解 owner kind，并扩大本 change 到 Tenant 路径，因此不采用。

### 将 key lifecycle 与 cipher construction 分开

infrastructure 提供两个不同语义的入口：

- provisioning entry point：在 key reference为空时创建或恢复 deployment key material，并持久化 reference；重复调用返回同一个 logical key。
- composition entry point：只从现有 identity/reference构造 `BoundCredentialCipher`；reference或 material缺失时失败。

decrypt path不得调用 provisioning。DB reference存在但 external key material缺失时也不得重新生成，因为替换 key 会让已有密文永久不可恢复。

新安装在创建带 `instance_id` 的 `DifySetup` 后调用 provisioning。migration 只增加 nullable字段，不在 schema migration 中访问 storage/KMS。既有安装可以在后续 deployment credential consumer启用前调用相同的幂等 provisioning entry point。

### 使用 DifySetup 持有 deployment key reference

`DifySetup` 新增 `credential_encryption_key_ref`。当前一个数据库对应一个 deployment owner，不新增 registry或独立 key table。

reference 是 provider-specific opaque value：

- local：RSA public key PEM。
- Azure Key Vault：deployment key name/reference。

`DifySetup.instance_id` 只用作稳定 owner identity和 backend key locator的一部分，不作为 cryptographic key material。

### local backend 使用独立路径并复用现有低层 primitive

local deployment private key保存在：

```text
privkeys/deployments/{instance_id}/private.pem
```

该路径与 Tenant 的 `privkeys/{tenant_id}/private.pem` 不重叠。provisioning 在 reference为空时先检查该路径：若 material已因先前部分成功而存在，则从 private key恢复 public reference；否则生成新 key pair。它不得覆盖已有可解析 private key。

bound cipher持有 public reference和 deployment private-key locator，复用现有 RSA-wrapped AES-EAX primitive；它不查询 `Tenant` ORM。实现可以在实例内部 lazy-load并复用 private decoding context，但不得将该优化暴露到 Protocol。

### Azure backend 使用独立 key name并保留 version语义

Azure deployment key name为：

```text
dify-deployment-{instance_id}
```

provisioning 在创建前检查该 logical key是否已有可用 version，避免重试产生无意义的新 version。ciphertext继续记录实际 wrap key version，decrypt固定使用密文中的 version；自动 rotation继续要求旧 version不设置 expiry。

deployment key name不得与 `dify-tenant-{tenant_id}` namespace重叠。Azure SDK error在 cipher boundary转换为稳定、不会泄露 credential或 provider raw payload 的错误。

### 保持 raw bytes boundary与 authenticated ciphertext

`encrypt` 返回 raw bytes，`decrypt` 接收 raw bytes。Base64和 application envelope由后续 consumer/codec负责，避免 transport concern进入 crypto interface。

local 与 Azure implementation都必须使用随机 data key/nonce并验证 authentication tag。相同 plaintext的重复加密应产生不同 ciphertext；截断、篡改、错误 deployment key或不支持的格式必须拒绝，而不是返回部分 plaintext。

### edition policy不进入 cipher或provisioner

provisioning 和 cipher construction不检查 CE、CLOUD 或 ENTERPRISE。新 self-hosted安装可以统一生成未使用的 deployment key；具备稳定 `DifySetup` 的其他 deployment也可以显式 provision。只有后续 EE application composition会消费这一 capability，本 change 不增加 CE/SaaS consumer。

## Risks / Trade-offs

- [DB commit 与 external key creation无法组成原子事务] → provisioning 必须从已存在的 local private key或 Azure logical key恢复同一个 reference，重试不得覆盖或创建另一个 logical key。
- [为暂不消费该能力的 edition生成未使用 key] → key体积和一次性 provisioning成本很小，换取 edition-neutral infrastructure和一致安装路径。
- [local/Azure deployment实现与 Tenant provider存在少量重复] → 本 change复用低层 crypto primitive，但不重构 Tenant runtime；待 Tenant 未来也采用 bound cipher后再收敛共享 factory。
- [切换 `KEY_PROVIDER_TYPE` 后已有 reference可能不兼容] → 本 change不支持 provider migration；construction必须显式失败，不得按新 provider覆盖旧 key。
- [旧 `SystemEncrypter` 继续绑定 `SECRET_KEY`] → 明确保留为后续独立 migration，不让本 change扩大到已有 system OAuth数据。

## Migration Plan

1. 以 nullable column migration增加 `DifySetup.credential_encryption_key_ref`，不执行 KMS/storage side effect。
2. 发布 `BoundCredentialCipher`、local/Azure deployment provisioning及 composition builder。
3. 新 installation path在持久化稳定 `instance_id` 时 provision deployment key并保存 reference。
4. 既有 deployment保持 reference为空，直到显式 provisioning entry point被调用；后续 consumer change必须在首次 credential写入前调用它。
5. 回滚应用代码时保留 nullable column和已经生成的 external key material，避免未来密文或重部署丢失 key；只有确认从未产生 deployment ciphertext后才可人工清理。

## Open Questions

无。
