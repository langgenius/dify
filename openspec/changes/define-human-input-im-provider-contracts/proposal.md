## Why

Human Input 当前已有 IM Integration、通讯录同步、binding、卡片投递与回调需求，但现有 spec 尚未给出 Dify 可以稳定依赖的 Provider 操作边界：联系人目录读取与消息发送仍容易因共享 SDK 或凭据被耦合，`WEBHOOK / STREAM` 也只有配置枚举而没有明确的事件汇合语义。现在需要把 explore 阶段已确认的真实操作固化成最小 contract，避免各 Provider 实现分别发明不同的 Dify-facing 语义。

## What Changes

- 定义只承载已确认操作的 Provider Integration contract：校验凭据、识别 provider tenant、检查基础权限与部署级 event transport 兼容性；transport mode 继续由部署配置决定，不由 tenant 管理员选择。
- 定义独立的 Provider Directory contract：一次读取必须先在内存中构建完整快照，只有完整成功后才允许 Dify reconciliation；目录读取不负责 Contact 匹配、binding 或消息发送。
- 定义独立的 Provider Messaging contract：测试已绑定 identity 的可达性；在 Delivery Endpoint 创建前评估 normalized interactive-card intent 是否可由目标 Provider 表示；五个初始 Provider 都通过独立的 link-message operation 发送 Request URL，Slack、Feishu/Lark 与 Microsoft Teams 额外通过独立的 card operation 发送交互卡片并按 capability 更新；所有发送返回精确 message/card reference，失败或 ambiguous outcome 本期不自动重试。
- 定义两层入站事件边界：transport-specific 接入在认证、验签或连接鉴权后产出 `AuthenticatedEvent`；provider-specific 卡片协议解码再产出 `CardSubmissionRequest`。
- 使用简单的 Dify-owned Inbox Repository 将 `AuthenticatedEvent` 直接写入 application database 的一张专用 inbox 表；transaction commit 后尽快完成 Provider ACK，再由 worker 从该表 claim 并处理记录。只在 Provider 提供 event ID 时去重；没有 event ID 时不合成去重键。
- 固化 Provider transport 支持矩阵：Feishu/Lark、DingTalk 与 Slack 支持 `WEBHOOK` 和 `STREAM`，WeCom 与 Microsoft Teams 仅支持 `WEBHOOK`。连接配额与滚动部署策略不进入本 change。
- 删除 Integration 时只处理本地状态：停止维护对应 stream connection、不再接受新的 inbound event 进入业务处理、删除本地凭据并移除当前 bindings/overrides；不调用 Provider 撤销授权或修改远端配置。
- 保持现有 effective IM binding 边界：只解析 `workspace override > organization binding`；新的 Provider contract 不接管上层 Email endpoint selection。

## Capabilities

### New Capabilities

- `im-provider-integration`: Provider credentials、tenant identity、permission 与部署级 event transport compatibility 的最小校验和本地删除语义。
- `im-provider-directory`: 从 Provider 读取完整 directory snapshot 的独立操作及完整性失败规则。
- `im-provider-messaging`: identity reachability、card representability assessment、彼此独立的链接消息与交互卡片发送、provider message reference、卡片更新及 no-automatic-retry 语义。
- `im-provider-events`: `WEBHOOK / STREAM` 的 transport-specific 接入、`AuthenticatedEvent`、inbox ACK、event-ID 去重与 `CardSubmissionRequest` 解码边界。

### Modified Capabilities

无。现有 `human-input-v2-im-control-plane-core` 已经把 Email endpoint selection 排除在 effective IM binding resolution 之外。

## Impact

- 影响 Dify-owned IM provider adapters、credential/client lifecycle、directory sync worker、Delivery Endpoint selection、outbound delivery worker、Webhook handler、stream connection runtime、单表 inbox migration/Repository、event inbox worker，以及 Human Input card interaction adapter。
- Provider SDK、凭据字段、directory pagination/topology、message/card payload 和 ACK 协议继续保持 Provider-specific；本 change 不要求统一这些外部协议。
- Contact matching、sync reconciliation、binding persistence、recipient resolution、submission authorization 与 workflow resume 继续由现有 Dify domain/application service 拥有，不下沉到 Provider contract。
- 本 change 不引入通用插件框架，不处理连接配额、滚动部署、自动发送重试、远端 revoke/unsubscribe、群聊通知或 Provider delivery receipt。
