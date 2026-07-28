## Why

Human Input v2 已经有 IM control-plane core，但当前没有 active implementation change 明确拥有 Integration configuration、credential/client construction 与 provider event transport。结果是 Contact Sync 被迫拥有一部分 provider foundation，Card Interaction 又准备实现另一部分 event transport foundation，容易让相同 provider 的 credential、revision、connection lifecycle 与错误边界分叉。

## What Changes

- 建立 Dify-owned 的 IM Provider Foundation，统一拥有 `IMIntegration` application boundary、provider tenant identity、credential encryption/rotation、complete CAS revision、最小 credential view、provider client construction 与 safe diagnostics。
- 把 Organization/workspace IM integration 的读取、配置、删除与 connection test application logic 从 Sync implementation change 移到独立的 integration management service；由 `human-input-v2-api-contracts` 拥有的 workspace 与 trusted internal controllers 复用同一 Dify service。
- 明确受支持 IM provider 的基础产品契约：directory read、message send 与 message/card update 是接入 Human Input 的必备能力，而不是运行时 capability flags。本 change 不引入通用 `CapabilityRegistry`，也不动态拼装 capability adapter graph。
- 增加可复用的 provider event transport，使用 provider-neutral `DISABLED / WEBHOOK / STREAM` 配置。Foundation 负责 webhook verification/handshake/ack、stream connection lease/fencing/reconnect、Integration revision binding，以及向业务 sink 交付 authenticated event envelope。
- 将 event transport 与业务事件语义分离：Foundation 不解析 card action、不构造 IM identity proof、不提交 Form，也不执行 directory reconciliation。Card Interaction 当前提供 card event sink；未来联系人自动同步可以在不复制 webhook/stream runtime 的情况下增加 directory event sink。
- 保持 downstream ownership：`implement-im-contact-sync-api` 只拥有 directory adapter、manual sync、reconciliation 与 identity/binding；`implement-human-input-v2-im-card-interaction` 只拥有 card render/send/update/fallback、card event normalization、durable interaction inbox 与 HITL v2 submission。
- 保持 Dify single-owner。EE 只拥有 administrator façade、typed Dify client 与 DTO/error mapping，不解密 provider credential，不构造 SDK client，也不运行 webhook/stream consumer。

## Capabilities

### New Capabilities

- `human-input-v2-im-provider-foundation`: 定义共享 Integration application boundary、credential/client factory、provider support baseline、safe diagnostics 与下游依赖规则。
- `human-input-v2-im-integration-management-api`: 定义 transport-neutral 的 IM Integration read/configure/delete/test application boundary 及单一 Dify implementation owner；不拥有 workspace/trusted internal HTTP contract。
- `human-input-v2-im-event-transport`: 定义 `WEBHOOK / STREAM` transport、authenticated event envelope、durable sink acknowledgement、lease/fencing 与业务语义隔离。

### Modified Capabilities

- `human-input-v2-im-control-plane-core`: 增加 provider-neutral event transport mode、mode configuration CAS 与不推进 configuration revision 的 operational health 规则。

## Impact

- Affected backend boundaries: `api/core/human_input_v2/im_integration/*`, `api/services/human_input_v2/*`, provider client packages, provider webhook transport controllers, and dedicated stream runtime registration. Workspace/trusted internal management controllers are owned by `human-input-v2-api-contracts`.
- Affected persistence: IM Integration event transport configuration、safe connection health与 stream lease/fencing records；需要显式 mapper、tenant/owner predicates 和 existing Integration 到 `DISABLED` 的无副作用迁移。
- Downstream changes: `implement-im-contact-sync-api` 不再拥有 integration CRUD、credential persistence或通用 provider client foundation；`implement-human-input-v2-im-card-interaction` 不再拥有 webhook verification、stream supervisor或 event transport mode。
- Provider baseline: Feishu、Lark、DingTalk 的 directory/message基础能力在provider接入验收时固定；只有 `WEBHOOK / STREAM` availability 使用窄的event transport support声明，不扩展成通用 capability system。
- Operations: 新增 webhook transport observability 与专用 stream consumer role；connection health、lease heartbeat和 reconnect diagnostics不得改变 Integration CAS revision。
