## Why

Public Human Input V2 已定义 `access-request` 和随表单提交的 `otp_code + challenge_token`，但当前入口仍待实现。需要基于现有 Form／Recipient／Delivery 补充 Email OTP，支持多个 API 节点处理发码和提交。

## What Changes

- 将每个 challenge 绑定到具体 Delivery，在共享 Redis 中独立保存十分钟；同一 Delivery 可以同时有多个有效 challenge，重发不替换旧记录。
- 按 Delivery 原子执行发码冷却和发送次数限制；每个 challenge 独立限制错误验证码次数。
- 使用部署级邮件配置发送固定 OTP 模板，不依赖租户 Email Channel。
- 先验证 OTP，再校验表单数据；正确 OTP 在提交成功前允许重复验证，表单仍只接受一次成功提交。
- 持久化 OTP 验证失败和 OTP 验证成功且表单提交成功的审计；验证成功但提交失败的审计可选，不新增独立 challenge 审计 ID。
- 提交成功后尽力删除本次使用的 challenge，其他记录自然到期；Redis 清理与数据库提交不要求原子性。
- 接入现有 `access-request`，提供 Submission 使用的内部验证能力，不新增独立验证 HTTP API。

## Capabilities

### New Capabilities

- `human-input-v2-email-otp`: Delivery 绑定的 Email OTP 发码、共享存储、频率限制、提交时验证及审计契约。

### Modified Capabilities

无。沿用 `human-input-runtime-form-api` 的 public Email API 契约，不恢复旧 grant／actor 模型。

## Impact

- Backend：`api/services/human_input_v2/`、`api/repositories/human_input_v2/`、现有 OTP 验证审计模型及 public access controller。
- Infrastructure：现有共享 Redis 和部署级 `ext_mail.mail`；不新增 challenge SQL 表、migration、发送队列或预约状态机。
- 后续 Submission 编排负责当前授权检查、表单校验、原子提交、同事务成功审计和 workflow resume。本 change 不修改进行中的 Runtime、IM 卡片、Console／Service API 授权或文件上传。
