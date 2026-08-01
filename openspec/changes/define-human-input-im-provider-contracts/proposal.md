## Why

Human Input 当前已有 IM Integration、通讯录同步、binding、卡片投递与回调需求，但现有 spec 尚未给出 Dify 可以稳定依赖的 Provider 操作边界：联系人目录读取与消息发送仍容易因共享 SDK 或凭据被耦合，`WEBHOOK / STREAM` 也只有配置枚举而没有明确的事件汇合语义。现在需要把 explore 阶段已确认的真实操作固化成最小 contract，避免各 Provider 实现分别发明不同的 Dify-facing 语义。

## What Changes

- 定义只承载已确认操作的 Provider Integration contract：校验凭据、识别 provider tenant、检查基础权限与部署级 event transport 兼容性；transport mode 继续由部署配置决定，不由 tenant 管理员选择。
- 定义独立的 Provider Directory contract：一次读取必须先在内存中构建完整快照，只有完整成功后才允许 Dify reconciliation；目录读取不负责 Contact 匹配、binding 或消息发送。
- 将 Provider Messaging 分为两组窄 contract：五个初始 Provider 都必须实现基础 Messaging，包括测试已绑定 identity 的可达性和发送 Request URL link message；Slack、Feishu/Lark 与 Microsoft Teams 额外实现可选的 Dynamic Card Messaging，包括无副作用的 card representability assessment、发送交互卡片和按精确 message reference 更新原卡片。基础消息是所有 Provider 的 fallback，不支持动态卡片的 Provider 不需要 dummy card methods；发送失败或 ambiguous outcome 本期不自动重试。
- 定义两层入站事件边界：transport-specific 接入在认证、验签或连接鉴权后产出 `AuthenticatedEvent`；provider-specific 卡片协议解码再产出 `CardSubmissionRequest`。本 change 保留 Dify-owned inbox persistence、ACK-before-business-processing 与 inbox worker claim 这条接入链路，但不扩展到更上层的 Human Input business processing 接线。
- 固化 Provider transport 支持矩阵：Feishu/Lark、DingTalk 与 Slack 支持 `WEBHOOK` 和 `STREAM`，WeCom 与 Microsoft Teams 仅支持 `WEBHOOK`。连接配额与滚动部署策略不进入本 change。
- 删除 Integration、停止事件进入业务处理、清理 bindings/overrides 仍属于 Dify-owned lifecycle，本 change 不覆盖这些本地状态变更。
- 保持现有 effective IM binding 边界：只解析 `workspace override > organization binding`；新的 Provider contract 不接管上层 Email endpoint selection。

## Capabilities

### New Capabilities

- `im-provider-integration`: Provider credentials、tenant identity、permission 与部署级 event transport compatibility 的最小校验语义。
- `im-provider-directory`: 从 Provider 读取完整 directory snapshot 的独立操作及完整性失败规则。
- `im-provider-messaging`: 所有 Provider 必备的 identity reachability 与 Request URL link-message contract，以及 card-capable Provider 可选实现的 representability assessment、card send/update contract、provider message reference 和 no-automatic-retry 语义。
- `im-provider-events`: `WEBHOOK / STREAM` 的 transport-specific 接入、`AuthenticatedEvent`、Dify-owned inbox/ACK convergence 与 `CardSubmissionRequest` 解码边界。

### Modified Capabilities

无。现有 `human-input-v2-im-control-plane-core` 已经把 Email endpoint selection 排除在 effective IM binding resolution 之外。

## Impact

- 影响 IM provider adapters、credential/client lifecycle、directory readers、basic/card messaging adapters、Webhook handlers、stream connection adapters、Dify-owned inbox persistence/worker path 和 card decoders。
- Provider SDK、凭据字段、directory pagination/topology、message/card payload 和 ACK 协议继续保持 Provider-specific；本 change 不要求统一这些外部协议。
- Contact matching、sync reconciliation、binding persistence、recipient resolution、submission authorization、workflow resume 和 caller wiring 继续由现有 Dify domain/application service 拥有；但 inbox persistence、ACK-before-business-processing 与 inbox worker claim 保留在本 change 范围内。
- 本 change 不引入通用插件框架，不处理连接配额、滚动部署、自动发送重试、远端 revoke/unsubscribe、群聊通知或 Provider delivery receipt。
