## Why

Dify 需要通过 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 提供一致的 IM 能力，但当前尚未定义一个统一拥有 Provider-specific configuration、SDK client 和连接资源生命周期的根对象。若 Directory、Messaging 与 Event capabilities 分别构造 SDK client，credentials、token cache、connection pool 和错误转换会重复且容易漂移。现在需要定义一个可稳定复用的 `IMProviderAdapter`，并从它暴露窄 capability views。

## What Changes

- 定义 `IMProviderAdapter` 根对象：由 Provider-specific typed configuration 构造，绑定 immutable configuration，统一拥有 SDK client bundle、token cache、connection resources 与关闭生命周期。
- Adapter 暴露独立 capability views，而不是一个包含所有方法的巨型接口。获取 Directory、Basic Messaging、Dynamic Card Messaging、Webhook Events 或 STREAM Events capability 不得重新构造 SDK client，也不得再次传入 credentials。
- `test_credentials()` 使用 adapter 已绑定的 API credentials，识别 Provider tenant 并检查基础权限；credential testing 与 event transport capability 保持独立。
- 定义独立的 Provider Directory capability：一次读取在 concrete adapter 内完成 Provider-specific pagination 或 hierarchy traversal，并只在完整成功后返回 immutable snapshot。
- 定义必备 Basic Messaging 与可选 Dynamic Card Messaging capabilities；每次方法调用至多执行一次 side-effecting Provider operation，且返回 Provider acceptance 与精确 Provider-owned message reference。
- 将 Webhook 与 STREAM 定义为两种独立 event capabilities。Webhook 由 HTTP caller 驱动，STREAM 由 Provider SDK callback 驱动；两者在 `AuthenticatedIMEvent` 与 application-supplied `IMEventSink` 处汇合，由 concrete adapter 负责 Provider-specific authentication、challenge/control frames 和 ACK mapping。
- Capability presence 是支持情况的唯一事实来源：五个初始 Provider 都暴露 Webhook Events；Slack、Feishu/Lark 与 DingTalk 额外暴露 STREAM Events；不支持的 Provider 不实现 dummy capability。
- 增加 Provider 实现验收门槛：每个 Provider 的每个外部 API 调用和事件处理入口都必须分别具备单元测试与集成测试；实现期间还必须完成对应的真实调用或真实事件处理，并将完整脱敏后的真实 payload 保留为单元测试 fixture。对于具有签名验证、加密 envelope 或 payload 解密的 Provider/transport，还必须为每条适用路径增加独立的验签与解密测试。

## Capabilities

### New Capabilities

- `im-provider-adapter`: 绑定 Provider-specific configuration、统一拥有 SDK/client lifecycle，并暴露 credential test 与 capability views 的根对象。
- `im-provider-directory`: 从 Provider 读取完整 directory snapshot 的独立操作及完整性失败规则。
- `im-provider-messaging`: 所有 Provider 必备的 identity reachability 与 `send_text` contract，以及 card-capable Provider 可选实现的 representability assessment、card send/update contract、provider message reference 和 no-automatic-retry 语义。
- `im-provider-events`: Webhook caller-driven 与 STREAM SDK-driven 的 transport-specific 接入、`AuthenticatedIMEvent`、`IMEventSink` 控制反转和 Provider-specific ACK mapping。

### Modified Capabilities

无。

## Impact

- 影响 IM Provider adapter composition、credential/client lifecycle、directory readers、basic/card messaging adapters、Webhook handlers 与 stream connection adapters。
- Provider SDK、配置字段、directory pagination/topology、message/card payload、signature/encryption 和 ACK wire protocol 继续保持 Provider-specific；本 change 不要求统一这些外部协议。
- `IMEventSink` 的具体 persistence、queueing、routing 或 consumer implementation 不属于 Provider adapter；本 change 只规定何时可以向 Provider 返回成功 ACK。
- 本 change 不引入动态插件框架，不处理业务 recipient resolution、delivery orchestration、event business decoding、连接配额、滚动部署、远端 revoke/unsubscribe 或 Provider delivery receipt。
- Provider adapter、Webhook/STREAM receiver 与事件 decoder 的实现验收需要维护逐项覆盖矩阵，并准备可用的非生产 Provider 环境、真实调用证据和完整脱敏 fixture；代表性 Provider 测试或手工构造 payload 不能替代逐项证据。
- 签名或密文不能在生成后直接脱敏并继续作为有效 cryptographic fixture；测试必须基于先脱敏的真实 payload 结构，使用测试专用 verification/encryption material 重新生成可验证的签名或密文，且不得提交真实 Provider secret 或 decryption key。
