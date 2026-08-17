## Why

`AuthenticatedIMEvent.payload` 对 Webhook 与 STREAM 分别保存不同顶层结构的 Provider-native JSON snapshot，但当前事件没有显式说明该 snapshot 依据哪一种 ingress contract 构造。Slack decoder 因此只能检查 payload 中的 Provider-specific 字段来推断顶层结构；Feishu/Lark 则额外构造 Dify-owned wrapper 来编码 transport provenance。两种方式都让持久化后的确定性解码依赖 payload 内的隐式标记，而不是 event contract。

## What Changes

- **BREAKING**：增加必填 `IMEventIngressKind`，初始只包含 `WEBHOOK` 与 `STREAM`，并将 `ingress_kind` 直接加入 immutable `AuthenticatedIMEvent`。
- 要求 Webhook handler 与 event stream 在构造 authenticated event 时显式记录实际 ingress kind；该值描述单次 delivery payload snapshot 的解释契约，而不是 deployment transport 配置。
- 保持 `AuthenticatedIMEvent.payload` 为实际 ingress 的完整 authenticated Provider-native payload：Webhook 保存完整 decoded/decrypted Provider JSON，STREAM 保存完整 Provider SDK callback serialization；在 `IMEventConsumer` 前不归一化两种 representation，也不创建第二份 canonical payload。
- Slack Webhook event 写入 `WEBHOOK` 并保留完整 callback JSON；Socket Mode event 写入 `STREAM` 并保留完整 Socket Mode request serialization。`_SlackCardCodec` 必须按 `ingress_kind` 显式 dispatch，STREAM 分支先解开 Socket Mode envelope，且不得再仅凭 `payload["type"] == "interactive"` 推断 ingress。
- Feishu/Lark Webhook event 写入 `WEBHOOK` 并直接保存 authenticated decrypted Provider JSON；STREAM event 写入 `STREAM` 并直接保存 `sdk_event.native_payload`。删除只用于编码 provenance 的 `_authenticated_webhook_payload`、`_authenticated_stream_payload` 及其 Dify-owned wrapper shape。
- `_MSFeishuLarkCardCodec` 必须先按 `ingress_kind` 显式 dispatch，再解析 Provider callback；STREAM object-type validation 保留在 stream adapter boundary，不得仅为 decoder dispatch 持久化 implementation-specific SDK class name。
- Provider-specific decoder 继续负责把同一 Provider 的两种 ingress representation 归一化为相同 `IMCardEvent`；invalid 或可辨识的 mismatched ingress/payload combination 必须显式失败，不能 fallback 猜测另一种 ingress。
- 在 `im_message_inbox` 增加 non-null ingress kind 列，将误导性的 `raw_payload` 存储字段统一命名为 `payload`，并在 event-to-record 与 record-to-event mapping 中原样保存和重建 `AuthenticatedIMEvent.ingress_kind` 与 `AuthenticatedIMEvent.payload`。
- 保持 inbox deduplication key 不变；ingress kind 不参与 event identity，因此同一 real Provider event 经不同 ingress 到达时仍解析为同一 identified event。
- 更新 Provider adapters、payload preservation、card convergence、mismatch rejection、inbox round-trip 与 cross-ingress deduplication tests，使所有 `AuthenticatedIMEvent` construction 都提供明确 ingress kind。
- 历史 inbox 数据兼容、存量分类、nullable/legacy discriminator 和数据回填不在本 change 范围内；当前没有历史数据，migration 直接增加 non-null 列。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `im-provider-events`: 为 authenticated delivery 增加显式 ingress provenance，并定义它与 payload snapshot、Provider decoding、event identity 及 transport implementation context 的边界。
- `im-message-inbox`: 将 ingress kind 作为 immutable authenticated event fact 原子持久化并无损重建，同时保持现有跨 ingress deduplication 语义。

## Impact

- 影响 `api/core/human_input_v2/im_provider` 的公共事件 contract 和所有 `AuthenticatedIMEvent` 构造方。
- 重点影响 Slack 与 Feishu/Lark inbound adapters 及其 card event decoders；其他 Provider event constructors 也必须适配 required field。
- 影响 `IMMessageInbox` ORM model、Alembic migration、repository mapper 和相关 SQLite/PostgreSQL tests；inbox ORM 与数据库列不再使用 `raw_payload` 这一平行命名。
- 这是 backend internal API 和 database schema 的不兼容变更，但不改变外部 HTTP API、Provider wire protocol、ACK semantics 或 deployment-level `event_transport_mode`。
- 删除 Feishu/Lark 为 provenance 构造的 payload wrappers；不增加连接状态、ACK handle、signature header、SDK client/class name 或其他 transport implementation context，也不改变真实 Provider event ID deduplication key。
