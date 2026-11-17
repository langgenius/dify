# Dify 部署级凭据加密设计

状态：已实现 local/Azure backend、provisioning、只读 builder、新安装接线及显式初始化 CLI；已接入 EE Human Input inner API 和部署同步 worker。日期：2026-11-11。

## 目标与现有能力

为没有 Tenant owner 的部署级凭据提供独立的加密解密能力，供 EE HITL 等功能使用。密钥由 Dify 创建、保存并在运行时加载；业务调用方只接收已绑定当前部署的 cipher。

已有实现可以提供参考：

| 实现 | 复用边界 |
| --- | --- |
| `libs.key_providers` | 复用 local RSA/AES-EAX、Azure Key Vault 的底层加密与认证机制；现有 Tenant 接口与密钥保持不变 |
| `core.tools.utils.system_encryption.SystemEncrypter` | 已用于系统 OAuth 参数，但依赖通用 `SECRET_KEY`，使用没有认证标签的 AES-CBC；保留现有调用方，新能力使用独立密钥 |
| EE `kms.Providers.Global` | 参考部署级密钥生命周期；Dify 的新能力不依赖 EE HTTP 调用或 EE 数据库 |

## 运行时接口

```python
from typing import Protocol


class BoundCredentialCipher(Protocol):
    """Encrypt credentials within an ownership boundary resolved by composition."""

    def encrypt(self, plaintext: str) -> bytes: ...

    def decrypt(self, ciphertext: bytes) -> str: ...
```

composition 解析当前部署及其密钥，构造具体 cipher 并注入业务 Service。调用方法不接受 `tenant_id`、deployment ID、key reference 或 provider 参数；密钥加载和可复用的解密上下文由实现内部管理。

通用 Protocol 位于 `api/libs/credential_cipher.py`；HITL 的 `IMCredentialCodec` 直接依赖它并接收已绑定 cipher。JSON、Base64、凭据 Pydantic 模型与持久化 envelope 继续由业务 codec 管理，不进入通用加密接口。

## 密钥身份与存储

使用稳定的 `DifySetup.instance_id` 定位部署，在 `DifySetup` 新增 nullable `credential_encryption_key_ref`。`instance_id` 不随升级重建，也不参与派生加密密钥；密钥必须随机生成。

后端沿用当前 `KEY_PROVIDER_TYPE`：

| 后端 | 部署密钥 | 数据库中的 reference |
| --- | --- | --- |
| `local` | 私钥保存在配置的 Storage 下：`privkeys/deployments/{instance_id}/private.pem` | RSA 公钥 PEM |
| `azure-keyvault` | Key Vault key：`dify-deployment-{instance_id}` | key name/reference |

部署命名空间与 Tenant 的 `privkeys/{tenant_id}/private.pem`、`dify-tenant-{tenant_id}` 分离。私钥不进入业务凭据表；`SECRET_KEY` 和虚构 Tenant 均不作为替代密钥来源。

local 复用 RSA 包装随机 AES 密钥、AES-EAX 加密并验证认证标签的机制。Azure 复用 envelope encryption，并在密文内记录实际 key version；解密固定读取该版本，已使用版本必须保持可访问。旧 reference 与当前配置的 provider 不兼容时失败，不覆盖原 reference。

## 生命周期

初始化和运行时构造使用两个不同入口：

- **Provisioning**：创建或恢复部署密钥，持久化 reference。它可以修改数据库和外部密钥存储。
- **Runtime builder**：从已有部署身份、reference 和后端密钥构造 cipher，只读，不创建密钥。

Provisioning 必须按 deployment 串行化并支持安全重试：

1. 部署身份缺失时失败，不临时生成另一套身份。
2. reference 和密钥均存在且匹配时，保留同一密钥。
3. reference 为空但外部密钥已存在时，从原密钥恢复 reference，处理“密钥创建成功、数据库提交失败”的重试。
4. 两者均不存在时才生成密钥；不得覆盖其他初始化请求已经创建的有效密钥。Azure 重试也不得无故创建新 key version。
5. reference 已存在但密钥丢失、损坏或不匹配时失败，不能自动生成替代密钥。

外部 Storage/KMS 与数据库不能原子提交，初始化实现必须保证部分成功可恢复。Service 管理短 Session/事务，Repository 使用注入的 Session；不为远程 KMS I/O 持有长数据库事务。

新安装在建立稳定部署身份后 provision。已有安装通过显式初始化入口补齐，并在部署级凭据功能启用前完成。Schema migration 只增加 nullable 字段，不执行 Storage/KMS 操作。

Runtime builder、encrypt 和 decrypt 均不触发 provisioning。API 与 worker 必须使用相同部署身份、数据库 reference 和密钥后端。数据库与 local 私钥需要配套备份恢复，恢复密文时不能重新生成密钥。

## 失败与验证

未初始化、密钥不可用或后端访问失败时，功能不能继续写入或使用凭据。解密必须拒绝格式错误、截断、篡改及使用另一部署密钥的密文，不返回部分明文。业务边界保留可处理的失败语义，响应和日志不包含凭据、完整密文或私钥。

开发验证至少覆盖：

- local/Azure 加解密往返、相同明文随机化、篡改与错误密钥拒绝。
- 并发 provisioning、重复初始化、外部创建成功但数据库提交失败后的恢复。
- 密钥丢失时拒绝重新生成；runtime builder 和 decrypt 不修改密钥生命周期。
- Azure 轮换后，新版本加密与旧版本密文解密。
- 新安装与已有安装初始化，以及原 Tenant 加密行为保持不变。

## 实施范围

部署级密钥引用、provisioning、local/Azure cipher 和 composition 入口由本能力交付；HITL inner API 的配置读写与部署同步 worker 通过独立的 inner API 变更接入。本能力不受 edition 限制；是否启用某个部署级业务由对应业务入口决定。

本次不扩展 Tenant `BaseKeyProvider` 的 owner 参数，不迁移现有 Tenant/SystemEncrypter 数据，不增加加解密 HTTP API、通用密钥 registry、local 密钥轮换或后端迁移能力。

## 实现与操作

- `libs/credential_cipher.py`：运行时 Protocol 与安全的 key-unavailable / invalid-ciphertext 错误。
- `libs/key_providers/deployment_{local,azure}.py`：独立 backend，不修改 Tenant provider。Local 使用 RSA-OAEP 包装随机 AES data key；Azure 使用 RSA-OAEP-256 包装，每次加密读取当前 version。两者以 AES-EAX 验证正文与 envelope header。
- `repositories/deployment_credential_repository.py`：使用注入的 Session 读取 setup 和条件保存 reference。唯一 nullable 字段由 migration `a84d72e9c61f` 增加。
- `services/deployment_credential_service.py`：初始化时按 instance ID 取得可续期 Redis lease，读取和持久化分别使用短 Session；Storage/KMS 不位于数据库事务内。运行时 builder 只读，不获取初始化锁或创建 key。
- `services/deployment_credential_composition.py`：读取既有 `KEY_PROVIDER_TYPE`、Storage 与 Azure 配置，Azure 继续通过 `DefaultAzureCredential` 认证。

新安装在 `DifySetup` 提交后初始化，key 创建失败时保留稳定身份供恢复。已有安装应用 migration 后，显式执行：

```bash
uv run --project api flask provision-deployment-credential-key
```

该命令不会打印 reference 或 key；缺少稳定 setup identity 时失败。可重复执行同一命令以恢复“外部创建成功、DB 未提交”的状态。若 reference 已存在而私钥/key 丢失，恢复原 Storage/Vault material；不能通过重新生成 key 恢复密文。

Azure 使用现有 `AZURE_KEYVAULT_VAULT_URL`、`AZURE_KEYVAULT_KEY_SIZE`、`AZURE_KEYVAULT_ROTATION_INTERVAL_DAYS`。运行身份需要相应 get/wrap/unwrap 权限；初始化还需要 create 与配置 rotation policy 的权限。已经加密的版本必须持续 enabled 且无 expiry。改变 provider 或 Vault 不构成 migration，builder 会拒绝不兼容或不存在的 reference/material。

本地行为测试与真实 Azure SDK 验证已通过：随机化、认证失败、错误 key、初始化重试、commit 失败恢复与版本轮换。真实 Azure 验证使用 `qg-kms-test` 的临时 key，之后已软删除并撤回临时授权；不提供持久应用凭证。后续已按用户指令在 box 完成全新 PostgreSQL 迁移、实际 Redis 并发 lease 与数据库 reference 行为验证，并从 box 对真实 Azure Vault 验证部署 Service 的 reference 持久化、幂等初始化、轮换与旧版本解密；详见 [box 集成报告](hitl-v2-ee-inner-api-box-integration-report.md)。

## 参考

- [现有 Tenant KeyProvider 接口](../api/libs/key_providers/base.py)
- [通用 bound cipher 接口](../api/libs/credential_cipher.py)
- [部署级 lifecycle Service](../api/services/deployment_credential_service.py)
- [现有 SystemEncrypter](../api/core/tools/utils/system_encryption.py)
- [HITL 凭据 codec](../api/services/human_input_v2/im_credential_codec.py)
- OpenSpec：`dify-specs/openspec/changes/add-deployment-credential-cipher/` 与 `implement-dify-ee-human-input-inner-api/`。
