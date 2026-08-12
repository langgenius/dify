## Why

原有 message locator contract 被命名为 `MessageReference`，并被定义为可持久化、可跨进程 round trip 的 opaque string；首个 Slack production adapter 又将它改成了可继承的 in-process marker class，随后其他 Provider 复制了这一实现。当前成功结果依赖 private Python dataclass、`isinstance` 与 pickle/class identity，既不符合既有 contract，也无法为数据库、队列和进程重启提供稳定的公共表示。

## What Changes

- **BREAKING (internal)**：将公共类型从 `MessageReference` 重命名为 `MessageLocator`，并定义为 `NewType("MessageLocator", str)`；不保留旧名称 alias，调用方只能持久化并原样返回字符串，不再接收或构造 Provider-private locator objects。
- 为 Slack、Feishu/Lark、DingTalk、WeCom 和 Microsoft Teams 建立 Provider-owned、versioned、lossless opaque locator codec；private Pydantic payload 使用 `strict=True`、显式 `v`/`p`、现有 `IMProvider`、JSON 和 URL-safe Base64。
- 将 `MessageAccepted.reference` 字段重命名为 `MessageAccepted.locator`，不保留兼容 property；要求每个成功 send 只在获得完整 exact-message locator 后返回 `MessageAccepted`。
- 要求每个 locator 只保存 version、Provider discriminator 和上游后续操作必需的最小 message locator，不复制 tenant/application identity 或本地 message kind。
- 要求每个 Provider-private Pydantic payload model 顶层 immutable、禁止 extra fields、显式 versioned，并且只包含 scalar/enum-like fields，不包含 sequence 或 mapping members。
- 固定各 Provider 的 exact private payload fields、字段注释和 authoritative Provider documentation URLs；Feishu/Lark 共用 `_FeishuLarkLocatorPayload` wire shape，保留两个官方门户 URL，并在 decode 后校验 `p` 与当前 adapter provider 一致。
- 要求 decoder 拒绝非法 URL-safe Base64 alphabet、malformed padding 和 invalid length。
- 要求 Dynamic Card replacement 从 opaque string 重新解码，并在 Provider I/O 前拒绝 malformed、unknown-version、wrong-provider 或 incomplete-locator references。
- 要求五个 Provider 都用 property-based testing 验证 private locator codec 的 `decode(encode(locator)) == locator`，同时用真实的 string/storage round-trip 测试替换 pickle、deepcopy、private-class 和 `isinstance` 测试，并覆盖 adapter recreation 与模拟 process boundary。
- 保持 locator payload 对调用方不透明；初始 codec 只做普通 versioned serialization，不添加 nonce、IV、加密、签名、MAC 或其他安全 envelope。共享边界仍假设 caller 不解析、修改或合成 locator。

## Capabilities

### New Capabilities

- `im-provider-message-locator`: 定义所有初始 IM Provider 的 opaque string locator、Provider-owned minimal-locator codec、持久化 round trip、locator validation 和 exact-message replacement boundary。

### Modified Capabilities

无。

## Impact

- 影响 `api/core/human_input_v2/im_provider/` 的公共类型，以及 Slack、Feishu/Lark、DingTalk、WeCom、Microsoft Teams concrete adapters。
- 影响所有断言 private locator class、private locator fields、pickle 或 deepcopy round trip 的 IM Provider tests。
- `MessageAccepted.reference` 被替换为 `MessageAccepted.locator: MessageLocator`，不保留兼容 property；Python runtime shape 从 private object 变为 `str`，尚未持久化的开发分支数据不提供 private-object migration compatibility。
- 不改变 Provider API mutation 次数、`MessageSendingResult`/`ReplacementError` taxonomy、card rendering、event transport 或 callback decoding contracts。
