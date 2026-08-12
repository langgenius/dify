## Context

`define-im-provider-adapter-contracts` 已把 message locator 定义为 caller-owned opaque persistent value：send 成功后，caller 可以把它存入文本边界，进程重启后原样重建，并交给 compatible adapter 定位同一条 Provider message。Review stub 原先将其命名为 `MessageReference`；本 change 将公共类型更准确地命名为 `MessageLocator = NewType("MessageLocator", str)`。

首个 Slack production adapter 落地时没有沿用该 runtime shape，而是引入可继承的 marker class 和 `_SlackMessageLocator` private dataclass；后续 DingTalk、WeCom 和 Microsoft Teams 沿用了同一模式，Feishu/Lark 则把已经序列化的 opaque payload 再包进 private dataclass。现有测试主要用 `isinstance`、pickle、deepcopy 或 private fields 证明同一 Python codebase 内可以复制对象，无法证明一个只保存字符串的 persistence/queue boundary 能在新进程中恢复 reference。

当前实现盘点如下：

| Provider verification unit | 当前 reference shape | 当前 locator facts | 主要缺口 |
| --- | --- | --- | --- |
| Slack | `_SlackMessageLocator` dataclass | message kind、channel ID、message timestamp | 无公共字符串表示；message kind 不是 upstream locator；replacement 依赖 class identity |
| Feishu/Lark | `_FeishuLarkMessageReference(opaque)` | version、Provider、tenant、message kind、message ID | opaque string 仍包在 private class 中；tenant/message kind 不是 upstream locator |
| DingTalk | `_DingTalkMessageLocator` dataclass | process query key | 只支持 pickle；缺少 versioned scalar envelope |
| WeCom | `_WeComMessageReference` dataclass | message ID | 只支持 deepcopy；缺少 versioned scalar envelope |
| Microsoft Teams | `_MSTeamsMessageLocator(serialized_value)` | version、message kind、tenant、client、service URL、conversation、activity | tenant/client/message kind 不是 upstream locator；replacement 仍依赖 private class identity |

本 change 修复公共 reference boundary 和五个 Provider codec，不引入 persistence repository，也不把 reference 变成外部用户可提交的授权凭据。

## Goals / Non-Goals

**Goals:**

- 将公共类型从 `MessageReference` 重命名为 `MessageLocator`，恢复其 nominal string contract，使 runtime value 是普通 `str`，static typing 仍能与任意字符串区分，且不保留旧名称 alias。
- 让每个 Provider 在自己的 concrete adapter 模块内拥有 versioned、可逆、可验证的 private codec。
- 只保留 Provider 后续操作真正需要的 upstream locator，而不通过公共 fields、subclasses 或 generic shared envelope 暴露实现细节。
- 让 JSON/text persistence、queue handoff、adapter recreation 和 process restart 只依赖保存的字符串，不依赖 pickle、Python class path 或 originating adapter memory。
- 在 Provider mutation 前拒绝 codec 能确定的 malformed、unknown-version、wrong-provider 和 incomplete locator references。
- 保持 send/replacement 的 at-most-once mutation contract 和现有 capability-scoped failure taxonomy。

**Non-Goals:**

- 不增加数据库字段、repository、queue schema 或新的 application persistence workflow。
- 不把 `MessageLocator` 暴露为 public HTTP request field，也不把它当作 authorization、authentication 或 anti-forgery credential。
- 不规定所有 Provider 使用同一个共享 payload model 或 codec class；除 Feishu/Lark 共用其 adapter module 内的一个 model 外，各 Provider 使用自己的私有 Pydantic model，并统一采用 JSON 后 URL-safe Base64 的编码管线。本 change 不引入 cryptographic mechanism。
- 不增加 message deletion、delivery receipt、status query 或 DingTalk/WeCom replacement capability。
- 不兼容或迁移 pickled private locator objects；它们从未构成稳定公共 persistence format。

## Decisions

### 1. The public locator is a nominal string, not a runtime class hierarchy

公共 contract 定义为 `MessageLocator = NewType("MessageLocator", str)`。`MessageAccepted` 的结果字段从 `reference` 重命名为 `locator: MessageLocator`，不保留兼容 property；runtime value 是不可变普通字符串。Caller 能够使用普通 text/JSON storage 保存该值，并通过 `MessageLocator(stored_value)` 恢复 static nominal type。旧的 `MessageReference` 名称不作为 alias 或 export 保留。

该定义前必须逐字保留指定注释，使 persistence、opacity 和 security non-goals 在公共 API 定义处可见。

Provider-specific reference classes、public parse API 和 public locator fields 全部移除。每个 concrete Provider 使用自己的私有 Pydantic payload model；payload model 和 encode/decode helpers 都保持模块私有。

选择该方案是因为 persistence boundary 需要语言无关的 scalar representation，而 `NewType` 不增加 runtime wrapper、serialization hook 或 module/class identity。备选方案是保留 marker base class并为每个 subclass 实现 serialization；该方案仍迫使 caller 或 persistence mapper认识 private class，且 rollback/import path/pickle compatibility 难以长期维护，因此拒绝。

### 2. Each Provider owns a versioned lossless codec

每个 concrete adapter 在自己的模块内定义一个私有 Pydantic payload model，并配置 `ConfigDict(frozen=True, extra="forbid", strict=True)`。Model 的 `v` 与 `p` 都是无默认值的 required fields，必须显式出现在 serialized JSON 中；`v` 使用 `Literal[1]`，`p` 直接使用现有 `IMProvider` 成员的 `Literal` 约束。其他成员只允许 scalar/enum-like values，不允许 sequence、mapping 或嵌套 container，因此顶层 frozen 足以覆盖完整 payload 的 immutable 语义。每个字段都有紧邻其声明的 English meaning comment，其中 `v` 和 `p` 分别固定使用 `# version of the locator` 与 `# provider of the locator`。每个 Provider-specific field 还必须逐字保留 delta spec 已确定的 authoritative Provider documentation URL；Feishu/Lark 的共享 `message_id` 同时保留两个官方门户 URL。

Encoder 先通过 private model 构造并验证 payload，再序列化为 JSON bytes，最后编码为 URL-safe Base64。Decoder 使用 strict URL-safe Base64 decoding，拒绝非 URL-safe alphabet、malformed padding 和非法长度，然后直接用同一 private Pydantic model 验证 decoded JSON。Decoder 不对 decoded bytes 做 Base64 re-encoding。正确性约束仅为 `decode(encode(private_payload)) == private_payload`。相同 payload 的多次编码不要求产生相同 locator string，因为 JSON 表示稳定性不是当前行为所依赖的性质。初始实现不添加 nonce、IV、随机 padding、加密、签名或 MAC。

初始 Provider 的 required private payload fields 为：

| Provider | Required private payload fields |
| --- | --- |
| Slack | `v: Literal[1]`; `p: Literal[IMProvider.SLACK]`; non-empty `channel_id: str`; non-empty `message_ts: str` |
| Feishu/Lark | `v: Literal[1]`; `p: Literal[IMProvider.FEISHU, IMProvider.LARK]`; non-empty `message_id: str` |
| DingTalk | `v: Literal[1]`; `p: Literal[IMProvider.DING_TALK]`; non-empty `process_query_key: str` |
| WeCom | `v: Literal[1]`; `p: Literal[IMProvider.WE_COM]`; non-empty `message_id: str` |
| Microsoft Teams | `v: Literal[1]`; `p: Literal[IMProvider.MS_TEAMS]`; trusted non-empty HTTPS `service_url: str`; non-empty `conversation_id: str`; non-empty `activity_id: str` |

Feishu/Lark 共用一个 `_FeishuLarkLocatorPayload` model 与同一 wire shape，不拆成两个 model；model 的 `p` 仍保存实际 Provider，adapter decode 后必须验证 `payload.p == self._provider`。其余 Provider 同样直接复用现有 `IMProvider`，不定义 locator-specific discriminator enum。

Encoded reference 不得包含 bot token、app secret、client secret、signing secret、access token、encryption key 或其他 credential material。共享 contract 不规定 encoded string 是否可被人工解码；“opaque”约束 caller 行为和公共 API surface，而不是要求 encryption。

备选方案是在 Provider-neutral package 建立一个 discriminated union envelope。该方案会把所有 Provider locator fields 变成共享 contract，并要求每次 Provider 演进都修改公共 package，因此拒绝。

### 3. Reference structure is validated before replacement I/O

Slack、Feishu/Lark 和 Microsoft Teams 的 `replace_with_static` 先执行 strict decoding 与 locator validation，再发起 Provider mutation。Decode 或 validation 失败统一返回 `ReplacementErrorKind.INVALID_REFERENCE`，且不得进行 Provider I/O。

Validation 比较 Provider discriminator，并验证所有 upstream locator fields 的完整性与 Provider-specific route safety，例如 Microsoft Teams trusted service URL。Reference structurally valid但目标 Provider message 已不存在或 Provider 不再允许 replacement 时，继续使用 `STALE_REFERENCE`；无法确认 mutation outcome 时继续使用 `UNKNOWN`。

该顺序保护 wrong-provider、incomplete-locator 和 malformed-reference 不触发 mutation。它不授权 caller synthesize reference；caller 仍必须只存储并原样返回 send result。Adapter identity 和授权应由调用路径与当前 credentials 决定，不通过复制 identity facts 到 locator 中实现。

### 4. Reference construction does not add identity lookups

只有在获得 Provider confirmed acceptance 和构造 persistent exact reference 所需的全部 upstream locator facts 后，send 才能返回 `MessageAccepted`。缺失必要 locator 时仍返回现有 `MessageSendingError`，不得自动 replay mutation。

Reference codec 不应为了填充 tenant、team、corp、app、client、bot 或 agent identity 发起额外 Provider lookup，也不应复制 typed credentials 中的这些字段。

如果 Provider 接受 mutation，但 response 缺少 exact locator field，adapter 仍返回现有 `MessageSendingError`，不得自动 replay；这是既有 ambiguous-acceptance 语义，不由本 change 改变。

### 5. Opacity does not introduce a security envelope

共享 contract 要求 lossless round trip、strict parsing、versioning 和 compatibility validation。初始 codec 只做普通序列化，不添加 encryption、MAC、signature、nonce、IV 或其他随机化/安全 envelope。没有 cryptographic authenticity 时，codec 可以检测 malformed 和 incompatible values，却不能承诺识别一个违反 caller contract、但重新编码为完全有效 payload 的恶意合成值。

因此 `MessageLocator` 必须保留在受信任的 application/persistence boundary 内，不能仅凭 locator 授权用户操作。如果未来需要完整性或机密性保护，应单独提出 change，明确 threat model、key lifecycle、rotation 和 stored-version migration，而不是在本修复中隐式加入。

选择这一边界是为了修复 persistence contract，而不把一个内部 locator 扩展成新的 security token protocol。

### 6. Tests enforce the codec law with property-based testing

公共 contract tests 断言 `MessageLocator.__supertype__ is str`，且 `MessageLocator(stored_value)` 的 runtime type 是 `str`，`MessageReference` 不再是公共 export，`MessageAccepted` 只有 `.locator` 而没有 `.reference`。每个 Provider 的 black-box tests 将 send result 的 locator 作为普通字符串写入 JSON/text representation，再只用恢复后的字符串和重新创建的 adapter执行适用操作。

五个 Provider codec 都使用 property-based testing 验证同一条最强性质：`decode(encode(private_payload)) == private_payload`。各 Provider 的 generator 只生成符合自身字段约束的有效 private Pydantic payload model，并覆盖每个 encoded field 的有意义边界；失败时由测试框架 shrink 为可复现的最小语义反例。observable 是解码后的 Pydantic model 相等，不是 encoded string 相等。

PBT 不替代 example-based tests。Missing/extra `v`/`p`、default-derived discriminator、wrong Provider、unknown version、invalid alphabet、malformed padding、invalid Base64 length、malformed JSON、strict Pydantic validation、exact field-comment and authoritative-URL retention、secret absence、exact payload shape、applicable exact replacement 和历史回归仍使用具名示例测试。旧的 pickle、deepcopy、private-field 和 `isinstance(private_locator)` assertions 删除，避免继续把 implementation accident 固化为 contract。

## Risks / Trade-offs

- [Internal Python runtime shape is breaking] → 在同一 release 中原子更新公共类型、五个 adapter 和所有 callers/tests；不保留 dual object/string path。
- [A minimal reference cannot pre-reject every cross-credential value] → reference 只负责定位 upstream message，不承担 adapter identity 或 authorization；Provider rejection 继续映射为现有 safe failure taxonomy。
- [Encoded strings may be longer than current scalar locators] → reference 只用于内部 persistence/queueing，各 Provider 应控制编码开销并增加合理长度边界测试。
- [Plain payloads do not detect malicious valid synthesis] → 明确 reference 不是 authorization token；保持 trusted internal boundary，安全需求另立 change，不在 codec 中隐式加入 nonce、encryption、signature、MAC 或全局 secret。
- [Future codec evolution can invalidate stored values] → 每个 codec携带 explicit version；decoder 对 unknown version fail closed，任何格式迁移必须先支持读取旧版本，再切换写入版本。
- [Dirty branch already contains Feishu/Lark and Teams codec edits] → 实施时基于当时工作树合并，不覆盖相邻 card-event work；本 proposal只规定最终行为。

## Migration Plan

1. 先添加 failing contract/provider tests，证明 runtime string shape、scalar persistence round trip和 replacement pre-I/O validation。
2. 将公共类型重命名为 `MessageLocator = NewType("MessageLocator", str)`，逐字保留指定注释，并同步 review stub 与 active `define-im-provider-adapter-contracts` 中已经漂移的 locator 文字。
3. 逐 Provider实现或收口 private versioned codec，并让 send直接返回 `MessageLocator(encoded_string)`。
4. 更新 Slack、Feishu/Lark 和 Microsoft Teams replacement，移除 private class checks，改为 decode + locator validation。
5. 删除 private reference classes和 pickle/deepcopy tests，运行 focused unit tests、lint、type check与 OpenSpec strict validation。
6. 由于该功能尚未形成可依赖的 production stored private-object format，不提供 data migration。部署必须使 contract与五个 adapter保持同一版本；rollback只能在新的 string references尚未被持久 consumer使用前整体回退。

## Open Questions

无。
