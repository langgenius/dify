## Why

当前 IM Integration 将每个 provider 的非敏感标识符和逐字段密文混合保存为 provider-specific persistence model。新增或修改 provider 配置字段时，持久化模型、union、mapper 和解密编排都必须同步修改；同时持久化层知道每个 provider 的 secret 字段，泄漏了本应由 provider credential owner 隐藏的知识。

IM Channel 写入已经要求完整凭据并执行整体 CAS，因此不需要支持单个持久化 secret 的独立更新。将完整配置作为一个版本化密文保存可以收敛该重复，同时隐藏配置结构和非展示元数据。

## What Changes

- 将 IM Integration 的持久化凭据从 provider-specific 的字段级密文 JSON 改为 `IMEncryptedCredentials` Pydantic model 表示的版本化整对象密文 envelope，并使用 `FrozenPydanticModelColumn` 持久化。
- 在 IM Integration 上单独保存 `ChannelSummary` 所需的安全应用标识符；Channel 列表和详情读取不得解密凭据。
- 保留 Console HTTP DTO 和 adapter 的 provider-specific resolved credential types；在加密前和解密后继续进行 provider-specific 校验。
- 移除 IM provider-specific encrypted credential persistence models、discriminated union 和仅为它们服务的 mapper 校验。

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `human-input-v2-im-control-plane-core`: IM Integration 凭据的保密持久化格式、读取校验和安全展示元数据要求。

## Impact

- 影响 `api/core/human_input_v2/im_integration/`、IM 配置服务、同步/运行时 adapter composition、IM repository mapper 与 `HumanInputIMIntegration` ORM 模型。
- 影响现有 IM Integration 凭据 JSON 的读写格式，但不改变 Console 请求/响应、provider adapter 的 typed credential contract、Integration CAS 或密钥 owner 选择规则。
- 当前 IM control-plane 尚未上线，因此不保留旧格式读取或数据回填；尚未发布的 schema/migration 定义直接切换为 envelope。
- 需要单元测试覆盖整对象加解密、provider 不匹配拒绝和 ChannelSummary 在不解密凭据时的投影。
