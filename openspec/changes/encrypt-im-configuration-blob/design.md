## Context

`HumanInputIMIntegration` 当前在 JSON 列中保存 6 个 provider-specific `*IMIntegrationEncryptedCredentials` model 的其中一个。写入路径逐字段调用 `encrypter.encrypt_token`，repository mapper 依据 provider 验证该 JSON，运行时 composition 再依据 provider 逐字段解密。`ChannelSummary.display_identifier` 直接从该 JSON 的明文标识符读取。

IM Channel create、update 与 replacement 都提交完整凭据并通过 Integration 的整体 CAS 写入。配置生命周期不支持单个 secret 的独立持久化更新。凭据 owner key 仍按现有规则选择：workspace-owned Integration 使用 workspace key，deployment-owned Integration 使用 deployment key。

当前 IM control-plane 尚未上线，因此不存在必须兼容的已部署字段级密文记录。实现可以直接替换未发布的 persistence schema 和 migration 定义。

## Goals / Non-Goals

**Goals:**

- 每个 IM Integration 只保存一个版本化的完整凭据密文，而不是 provider-specific 的字段级密文 JSON。
- 将凭据字段结构和 secret 分类限制在 Console DTO、resolved credential model 与 provider adapter 附近；domain、ORM 和 repository mapper 只处理 opaque envelope。
- 保持 ChannelSummary 的读取不解密凭据，并保持现有的 Console API、CAS、provider replacement 与 key owner 规则。

**Non-Goals:**

- 不合并 Console DTO 或 provider-specific resolved credential model。
- 不改变 key provider、加密算法、secret masking、provider credential test 或 event transport 配置。
- 不新增凭据读取 API、部分凭据更新或可按字段查询的持久化配置。
- 不在 Channel list/detail 请求中解密凭据。
- 不支持旧字段级密文的双读、回填或已上线数据迁移。

## Decisions

### 保存单个 versioned ciphertext envelope

IM credential owner 在 provider-specific resolved credential model 已完成本地校验后，将包含 provider discriminator 和所有配置字段的 JSON 作为一个值调用现有 `encrypter.encrypt_token`。`HumanInputIMIntegration.encrypted_credentials` 保存 provider-independent envelope，例如 `version` 与 `ciphertext`，而不保存任何 credential field name 或 field value。

`EncryptedCredentials` 从“包含字段级密文的 opaque JSON”改为真正的 opaque envelope value。IM domain、ORM record 和 repository mapper 只复制、比较和持久化该值；它们不得按 provider 解析 credential payload。

持久化 schema 固定为一个直接继承 `BaseModel` 的 Pydantic model；它替换当前同名的 provider-specific union。model 显式声明 `extra="forbid"`、`frozen=True` 与 strict validation，因此 envelope 只声明 format version 和不可为空的 ciphertext：

```python
class IMEncryptedCredentials(BaseModel):
    """Versioned opaque credential envelope persisted for one IM Integration."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    version: Literal[1] = Field(default=1, description="Credential envelope format version.")
    ciphertext: str = Field(min_length=1, repr=False, description="Encrypted complete credential payload.")
```

`HumanInputIMIntegration` 直接以该 concrete model 定义列，禁止使用 `TypeAdapter`、discriminated union 或 `model_types`：

```python
encrypted_credentials: Mapped[IMEncryptedCredentials] = mapped_column(
    FrozenPydanticModelColumn(IMEncryptedCredentials),
    nullable=False,
    comment="Versioned opaque encrypted IM credential envelope stored as JSON.",
)
```

字段级方案便于 ORM 验证 JSON，但该验证重复了写入前的 DTO/resolved credential 验证，并把 provider schema 泄漏到 persistence。整对象方案与完整配置 CAS 的原子性一致，并将每次配置写入的加密调用数降为一次。

### 将安全展示标识符显式保存为 Integration metadata

配置确认时从已校验的 resolved credentials 提取安全的 app/client/corp identifier，写入一个 provider-independent `app_identifier` metadata field。该字段不得包含 API key、secret、token、verification token 或 encrypt key。`HumanInputIMIntegrationManagementService` 生成 `IMChannelSnapshot` 时只读取 metadata；不再读取或解密 credential envelope。

保留 provider 与 provider tenant identity 的独立列，因为它们决定 Integration 的资源身份、CAS/replacement 语义和 adapter 选择。它们不是凭据 payload 的替代来源。加密 payload 中重复 provider discriminator，并在解密后与 Integration provider 比较，以防止错误的密文被解释为另一 provider 的配置。

### 在一个 credential loader 中恢复并校验运行时凭据

新增一个只在 application/infrastructure composition 使用的 credential loader。它根据 Integration owner key 解密 envelope，解析 JSON，并用该 Integration provider 的 resolved credential model 校验 payload。loader 返回 typed credential model 或安全的配置读取失败；调用者在失败时不得构造 adapter 或执行 provider I/O。

provider-specific schema 仍由 adapter credential model 定义。配置写入和 loader 共享同一 provider-to-model mapping，避免 repository、ORM 与多个 runtime composition 分别维护加解密字段映射。

### 直接替换未发布的字段级格式

实现直接删除 6 个 provider-specific encrypted credential model、union、legacy field mapper 和逐字段解密路径。尚未发布的 `HumanInputIMIntegration` schema/migration 定义改为 envelope 与 `app_identifier`，不添加旧格式 parser、双读逻辑或数据回填任务。

## Risks / Trade-offs

- [单个密文损坏会使整份配置不可用] → loader 在任何 provider I/O 前拒绝无效 version、无法解密、非对象 JSON、provider mismatch 或 resolved-model validation failure，并只暴露安全诊断。
- [列表查询失去明文 client/app ID] → `app_identifier` 在配置确认时单独保存，并作为 ChannelSummary 的安全展示来源。
- [加密 envelope 的格式未来变化] → version 是强制字段；未知版本直接拒绝，不猜测或降级解析。

## Migration Plan

1. 直接将未发布的 `HumanInputIMIntegration` schema/migration 定义改为 envelope 与 `app_identifier`。
2. 将 create、update、replacement 与 runtime adapter composition 切换到 envelope；HTTP contract 和 Integration revision 行为保持不变。
3. 删除 6 个 provider-specific encrypted persistence model、union、mapper 分支和逐字段解密代码。

在发布前回滚时，回退未发布的 schema/migration 定义与代码即可；不需要反向解密或转换已上线数据。

## Open Questions

无。
