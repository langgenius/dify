## Why

Dify 需要通过 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 提供一致的 IM 能力，但当前尚未定义一个统一绑定 Provider-specific configuration、复用 API client context 并暴露窄 capability views 的根对象。Credential testing、Directory、Messaging 与 Dynamic Card Messaging 可以在一个 externally serialized root-context boundary 内复用资源；Webhook handling 必须是只依赖 immutable configuration 的 thread-safe request boundary；STREAM connection 则需要独立的跨线程生命周期。现在需要定义这三个明确分离的 execution and ownership models。

## What Changes

- 定义 `IMProviderAdapter` 根对象：由 Provider-specific typed configuration 构造并绑定 immutable configuration；它可以拥有供 credential testing、Directory、Basic Messaging 与 Dynamic Card Messaging 借用的 Provider API client context，并通过幂等 `close()` 释放，没有可关闭资源时 `close()` 为 noop。配置不得 inplace 更新；新配置只能创建新 adapter，且新实例的构造不修改、不失效、不关闭旧实例。每个 adapter 的 owner 在各自独立生命周期结束时决定是否调用 `close()`，root adapter 不参与 configuration rollout。
- Root operations、Directory、Basic Messaging 与 Dynamic Card Messaging 必须由 caller externally serialize，且 non-reentrant；同一 adapter 上的这些调用不得 overlap，但可在 safe handoff 后由不同 threads 顺序执行，implementation 不提供并发调用协调。`IMWebhookEvents.handle()` 与 `IMEventSink.accept()` 遵循各自独立的 thread-safe contract；Webhook 只绑定 immutable Webhook configuration，不借用 root-owned runtime resources，并可与 root usage 或 close 并发。
- `test_credentials()` 使用 adapter 已绑定的 API credentials，识别 Provider tenant 并检查基础权限；credential testing 与 event transport capability 保持独立。
- 定义独立的 Provider Directory capability：一次读取在 concrete adapter 内完成 Provider-specific pagination 或 hierarchy traversal，并只在完整成功后返回 immutable snapshot。
- 定义所有初始 Provider 必备的 Basic Messaging，以及仅 Slack、Feishu/Lark 与 Microsoft Teams 提供的可选 Dynamic Card Messaging capabilities；DingTalk 与 WeCom 本期不暴露 Dynamic Card Messaging。Directory 与 Messaging 共享 nominal `ProviderUserId`，concrete Messaging capability 负责把用户身份转换为私有 transport addressing。Dynamic Card Messaging 通过无副作用 Card Assessment 对完整 HITL-aligned card intent 做 Provider-specific representability judgment。每次发送至多尝试创建一条消息，并返回 Provider acceptance 与精确 Provider-owned message reference。
- 将 Webhook 与 STREAM 定义为两种独立 event capabilities。Webhook view 可以被多个 request threads 并发调用并 outlive root close；`create_stream_events()` 是唯一 thread-safe root operation，每次为支持的 Provider 创建一个独立 `IMStreamEvents`。每个 STREAM instance 遵循 terminal `NEW -> RUNNING -> CLOSED` 状态机且至多执行一次 `run()`；`close()` 可跨线程调用，并可从 `NEW` 或 `RUNNING` 永久转入 `CLOSED`。根 adapter 不跟踪或级联关闭这些独立 event lifecycles，application-supplied `IMEventSink` 必须能够安全处理并发调用。
- Capability presence 或 STREAM factory result 是支持情况的唯一事实来源：Slack 与 Feishu/Lark 暴露 Webhook Events 且 `create_stream_events()` 返回独立实例，Microsoft Teams 仅暴露 Webhook Events；DingTalk 与 WeCom 本期不暴露任何入站 event capability；不支持 STREAM 时 factory 返回 `None` 而不是 dummy capability。
- 增加 Provider 实现验收门槛：每个 Provider verification unit 的每个外部 API 调用和事件处理入口都必须具备单元测试与集成测试；实现期间还必须完成对应的真实调用或真实事件处理，并将完整脱敏后的真实 payload 保留为单元测试 fixture。初始 verification units 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams；Feishu 和 Lark 保持两个 concrete adapter，但共享协议实现按一个证据单元验收，并固定使用授权飞书非生产环境作为该单元的真实执行与 fixture 来源。对于具有签名验证、加密 envelope 或 payload 解密的 Provider/transport，还必须为每条适用路径增加独立的验签与解密测试。

## Capabilities

### New Capabilities

- `im-provider-adapter`: 绑定 immutable Provider-specific configuration、拥有可选共享 API client context、规定 caller-managed root-context serialization，并暴露 credential test、capability views 与 thread-safe STREAM factory 的根对象。
- `im-provider-directory`: 从 Provider 读取完整 directory snapshot 的独立操作及完整性失败规则。
- `im-provider-messaging`: 所有 Provider 必备的 `send_text` contract，以及 card-capable Provider 可选实现的 representability assessment、card send/update contract、provider message reference 和 no-automatic-retry 语义；recipient reachability 只通过真实 send result 表达，不提供独立 preflight。
- `im-provider-events`: config-only thread-safe Webhook request handling、STREAM SDK-driven transport 接入、single-run terminal STREAM state machine、thread-safe `IMEventSink` 控制反转、`AuthenticatedIMEvent` 和 Provider-specific ACK mapping。

### Modified Capabilities

无。

## Impact

- 影响 IM Provider adapter composition、externally serialized shared client lifecycle、directory readers、basic/card messaging adapters、config-only thread-safe Webhook handlers 与 independently closed stream connection adapters。
- Provider SDK、配置字段、directory pagination/topology、message/card payload、signature/encryption 和 ACK wire protocol 继续保持 Provider-specific；本 change 不要求统一这些外部协议。
- `IMEventSink` 的具体 persistence、queueing、routing 或 consumer implementation 不属于 Provider adapter；本 change 只规定何时可以向 Provider 返回成功 ACK。
- 本 change 不引入动态插件框架，不处理业务 recipient resolution、DeliveryEndpoint planning、delivery orchestration、event business decoding、连接配额、滚动部署、远端 revoke/unsubscribe 或 Provider delivery receipt。
- Channel Test connection 继续由 channel-management/application orchestration 组合 root credential test、channel-level checks 和 test policy 要求的真实 send operation；message-template test、Debug Mode 和 runtime delivery 使用真实 Messaging send operation，不在 adapter 中增加 connection-test 或 recipient-reachability probe。
- Provider adapter、Webhook/STREAM receiver 与事件 decoder 的实现验收需要维护逐项覆盖矩阵，并准备可用的非生产 Provider 环境、真实调用证据和完整脱敏 fixture。除明确定义为一个 verification unit 且固定由飞书环境提供真实证据的 Feishu/Lark 外，一个 Provider unit 的代表性测试或手工构造 payload 不能替代另一个 unit 的逐项证据。
- 签名或密文不能在生成后直接脱敏并继续作为有效 cryptographic fixture；测试必须基于先脱敏的真实 payload 结构，使用测试专用 verification/encryption material 重新生成可验证的签名或密文，且不得提交真实 Provider secret 或 decryption key。
