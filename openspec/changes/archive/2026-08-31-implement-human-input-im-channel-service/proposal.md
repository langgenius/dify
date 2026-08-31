## Why

`refactor-human-input-im-channel-domain` 已将 IM Channel persistence 收敛为 owner-bound `IMChannelReader` / `IMChannelWriter`，但它刻意不定义 Provider preparation、operation selection、transaction span 或 API orchestration。旧 `HumanInputIMIntegrationManagementService` 及其 composition 已被删除，Console callers、Provider preparation contracts、credential codec 与配置版本投影仍需迁移到新的 application owner。

## What Changes

- 新增 `IMChannelService`，统一执行 current read、candidate test、create、ordinary update、explicit replacement 与 delete。
- Service 在调用 Repository 前完成 Provider authentication、permission checks、Provider tenant resolution、safe metadata extraction 与 credential protection；Provider I/O 不进入数据库 transaction。
- Service 根据 current Channel 与 prepared Provider tenant identity 决定 ordinary update 是否允许；Provider 或 Provider tenant 变化返回现有 `replacement_required`，不调用 Repository mutation。
- Service 构造 Channel ID、`webhook_id`、timestamps、status 与 numeric version。Ordinary update 保留 Channel ID/`webhook_id` 并推进 version；explicit replacement 生成新 ID/`webhook_id` 和 initial version。
- 新增deployment-owned `IMEventTransportMode(WEBHOOK/STREAM)`与required `HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE` typed配置；Service与后续ingress直接读取该全局配置，缺失或非法值在配置加载时失败，mode不进入Console DTO、Channel persistence或credential envelope。
- `IMProvider.supports_webhook()` 成为唯一Provider-level Webhook capability source；`im_channel_service.py` 私有 `_generate_im_provider_webhook_url(webhook_id)` 使用`TRIGGER_URL`和固定`/callbacks/human-input/v2/im/<webhook_id>`路径构造URL；Service仅在`WEBHOOK` mode且Provider支持时返回URL，其余情况返回`None`，本change不实现Webhook ingress。
- Workspace Service constructor绑定 trusted Tenant、Account 与 credential codec；Service 在短 caller-owned SQLAlchemy transaction内直接构造 owner-bound `WorkspaceIMChannelReader` / `WorkspaceIMChannelWriter`，operation arguments不传播owner、actor或infrastructure context。
- Service 将 `IMChannelAlreadyConfiguredError`、`StaleIMChannelWriteError` 与 Provider failures映射到现有 credential-safe Channel application errors；其他 persistence failures保持未分类并进入通用 internal-error boundary。
- **BREAKING（内部）**：删除残留的old Integration management contracts、exports、credential envelope引用和失效测试；Channel configuration application callers迁移到 `IMChannelService`。
- 保留已确认的 CE/SaaS Workspace Console Channel routes、request/response DTOs、Provider credential DTOs、`ChannelSummary`、OpenAPI shape、HTTP error/status contract 与 opaque `ConfigVersion` wire format；controller只负责认证、trusted Workspace context注入、参数/版本验证、资源存在性错误转换与response projection。
- EE不复用这些Workspace Console routes；后续EE change通过独立Dify inner API暴露deployment-bound管理能力，并复用shared `IMChannelService` implementation。
- Edition与API owner scope不匹配时，transport admission MUST在认证、DTO解析和Service construction之前返回HTTP `501`：Enterprise调用Workspace Console API时拒绝，Community/Cloud调用未来EE inner API时对称拒绝；Service和Repository不接收edition。
- 不修改 `IMChannelReader` / `IMChannelWriter` schema、mapping或CAS，不修改Identity、Binding、Sync/Reconciliation、Inbox、Webhook runtime或其他通过 `integration_id` 引用旧identity的dependent owners。

## Capabilities

### New Capabilities

- `human-input-v2-im-channel-service`: 定义 `IMChannelService` operations、Provider preparation、operation selection、Channel value construction、transaction orchestration与stable failures。

### Modified Capabilities

- `human-input-channel-management`: 将 IM Channel application owner从旧Integration service切换为 `IMChannelService`，保持confirmed API与client recovery behavior。
- `human-input-channel-management-console-api`: 在Enterprise edition上对全部canonical Workspace Channel paths执行认证前HTTP `501` gate，避免Workspace transport访问deployment-owned状态。
- `human-input-v2-im-control-plane-core`: 删除旧Integration configuration application transitions/service ownership；Repository与dependent control-plane owners保持分离。

## Impact

- Reference：change-owned `service.py` 冻结共享 `IMChannelService`、Workspace constructor、future Deployment constructor、Provider preparation 私有值及 credential-free `IMChannelView` API；该文件不可被 production code import。
- Application：新增 `api/services/human_input_v2/im_channel_service.py` 及Channel-specific preparation/contracts。
- Core：在 `IMProvider` 上新增credential-free `supports_webhook()`，固定当前adapter capability而不读取credentials或构造adapter。
- Configuration：新增required typed IM event transport mode，供Channel projection与后续ingress handler直接复用。
- Composition：Console request以trusted Tenant、Account、Session factory与Key Provider构造 `WorkspaceIMChannelService`；Service内部选择Workspace Reader/Writer与credential codec。
- Removed：残留的old Integration management contracts、exports、credential codec引用和obsolete management tests。
- Controllers：保留CE/SaaS Workspace Channel API，仅替换imports、Workspace Service construction/calls、`IMChannelView`-to-`ChannelSummary` projection和opaque version内部mapping；EE inner API不在本change范围内。
- Tests：Workspace Service use cases、Provider-I/O ordering、transaction rollback、operation selection、safe view、error mapping与unchanged API contracts。
- Dependencies：实现前必须完成 `refactor-human-input-im-channel-domain` 的Repository contracts。
