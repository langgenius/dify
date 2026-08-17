## Context

Canonical Channel Management 已为 Resend 和 self-managed Slack 提供完整 operation，Feishu/DingTalk 仍使用 unavailable implementations，Lark、Microsoft Teams 和 WeCom 尚未进入 provider/candidate union。底层 IM Control Plane 与现有 provider adapters 已覆盖这些 provider family；缺口在 management contract、credential validation/persistence wiring 和 safe Console mapping，而不是 directory synchronization。

本 change 只完成 backend configuration lifecycle。Manual sync runtime、OAuth lifecycle 和 provider directory read 由其他 owner 负责。

## Goals / Non-Goals

**Goals:**

- 让 Resend 和当前完整 IM provider set 通过同一 canonical management facade 暴露。
- 保持 provider-specific typed candidates、credential owner 和 Integration CAS invariants。
- 让每个 complete channel reference 暴露 concrete Console route 和准确的 operation-specific schema。
- 将 configuration create/update 和 destructive provider replacement 变成显式调用意图。
- 让 successful IM create/update 产生可持久化、credential-free 的 connected diagnostic。
- 保持 controller 为 thin transport adapter。

**Non-Goals:**

- 不读取 provider directory，不实现 reconciliation 或 Celery dispatch。
- 不新增 credential schema，除非 existing adapter contract test 证明必要。
- 不实现 Slack OAuth authorize/callback/token lifecycle。
- 不实现 EE transport。

## Decisions

### 1. Remove the handler registry and bind concrete provider managers

Concrete Workspace route 已经确定完整 `(kind, provider)`，因此 production composition 直接把对应 `HumanInputEmailChannelManager` 或 `HumanInputIMChannelManager` 绑定到 route operation。`HumanInputChannelManagementService` 可以保留共同的 safe result、capability 和 lifecycle orchestration，但不得通过 `ChannelRef` 查找 provider implementation。

本 change 删除 `ChannelHandler`、`ChannelHandlerRegistry`、`DuplicateChannelHandlerError` 及其 register/resolve/handlers flow。Channels collection 使用 production composition 中固定、按 product order 声明的七个 provider manager 读取 current view，并继续隔离单个 provider read failure。Feishu 与 Lark 可以共享 provider-family dependencies，但不通过 registry registration 表达 addressability。

### 2. Preserve provider-specific candidate types

Application commands 保持 provider-specific typed candidate，而不是 untyped configuration map，但 create、update 与 test 使用独立 command。Concrete route 决定 provider 并调用已绑定的 provider manager；transport payload 不重复 provider discriminator，application service 也不执行 provider lookup。

Create、update 与 test 使用同一个完整 provider-specific candidate model。所有 non-nullable fields，包括每个 required secret，在三个 operation 中都必须显式提交；nullable fields 可以省略或提交 `null`，两者都表示 candidate 中的最终值为 `null`。Update 不读取 current credentials 做 retention/merge，也不暴露 `PreserveOriginalValue`。

### 3. Expose one concrete Console route per complete channel reference

Workspace Console 注册以下 concrete item/test paths：`email/resend`、`im/slack`、`im/feishu`、`im/lark`、`im/ding_talk`、`im/ms_teams` 与 `im/we_com`。Kind 与 provider 均不使用 dynamic route segment。未知 kind/provider 不注册 catch-all resource，由 HTTP routing 直接返回 `404`，且不得构造 management service。

每个 item route 使用 provider-specific create/update request schema 和 provider-specific credential-free current view。IM providers 共享一个 credential-free connection-test response 和 common safe error response；不为结构相同的 provider test result 复制 response type。Controllers 可以复用 transport helpers，但 concrete Resource 必须拥有静态 `ChannelRef` 和准确的 Swagger decorators。

### 4. Separate configuration create and update

`POST` 创建 configuration，只在当前 owner 尚无该 channel kind 的 active configuration 时成功，且不接受 revision token。成功返回 `201` 和 authoritative configured view。`PUT` 更新现有 configuration，必须携带完整 `integration_id`/`config_version` CAS token；不存在 current configuration、缺失 token 或 stale token 时，必须在 provider I/O 前失败。成功返回 `200` 和 authoritative configured view。

同一个 provider-specific current view 可以供 GET、POST、PUT 与 DELETE 复用；只有 wire shape 不同时才增加 operation-specific response type。

### 5. Require explicit replacement authorization

IM update payload 包含 `replace_current: bool = false`。该字段是 destructive replacement consent：当 target route provider 不同于 current provider 时，`false` 必须在 provider I/O 前返回 stable conflict；当 credential validation 发现同 provider 的 provider tenant identity 已变化时，`false` 必须在任何 persistence 前返回 replacement-confirmation-required failure。

`replace_current = true` 允许 IM Control Plane 根据 validated provider identity 决定 credential rotation 或 provider/provider-tenant replacement，但不强制一次本来属于 rotation 的 update 变成 replacement。跨 provider replacement 必须提交 target provider 的完整 candidate，并使用 current Integration 的完整 CAS token。

### 6. Test only the submitted complete candidate

Connection test 是 save 前的 candidate validation。Test request 使用与 create/update 相同的完整 provider-specific candidate；test 不得 reveal、merge 或复用 persisted credentials，也不接受 `PreserveOriginalValue`。所有当前 IM provider 复用 common connection-test response，失败通过 stable safe category/code 和可安全展示的 message 表达。

### 7. Validate provider connectivity before opening the persistence transaction

Credential authentication、required-scope validation 和 provider tenant identity resolution 属于 external I/O，必须在 database transaction 外完成。Validated result 返回 credential-free metadata；manager 随后在一个 explicit transaction 中应用 configuration transition 与 connected diagnostic。

把 provider I/O 放入 transaction 会扩大 lock duration；让任一调用方从 submitted candidate 推断 connected state 会使其本地状态超前于 persisted facts，因此均拒绝。

### 8. Create and update persist configuration and diagnostics atomically

Create/update 成功时，configuration transition 推进 `config_version` 一次，`record_diagnostics(CONNECTED, checked_at, safe_metadata)` 与其同 transaction 持久化但不再次推进 version。Failed validation 或 replacement authorization failure 在进入 write transaction 前结束，不能修改 current state。Connection test 返回 `ChannelTestResult`，不写 credentials、diagnostics 或 configuration revision。

### 9. Management reuses existing adapters without owning directory reads

Provider manager 可以复用 existing provider adapter 的 credential validation/tenant identity capability，但不得调用 `directory.read_directory()`，也不得新增 provider directory HTTP client、pagination 或 normalization。Directory ownership 保持在 sync worker 的 `IMProviderAdapter` path。

### 10. Controllers map trusted context into the facade

Workspace Console controller 只构造 trusted management context、解析 Pydantic DTO、调用 `HumanInputChannelManagementService` 并映射 stable safe errors。Repository、credential protector、provider adapter 和 provider payload 不得上浮到 controller。

## Risks / Trade-offs

- [Concrete routes 增加 Resource 数量] → 复用 controller execution helpers，但保留 concrete Resource/schema registration 作为公开 contract。
- [删除 registry 后 collection 仍需聚合七个 provider] → 在 production composition 中使用固定 product-order dependency list；禁止恢复 runtime registration 或 `ChannelRef` lookup。
- [Update 无法从 credential-free response 重建 Secret] → 管理员更新配置时必须重新提交全部 required secrets，以换取单一、准确的 request schema 和无 retention/merge 分支的 credential flow。
- [Provider replacement 可能误清理 identities/bindings] → 默认 `replace_current = false`，只有显式 consent 才允许 destructive aggregate transition。
- [Validation succeeds but provider state changes before commit] → persisted diagnostic 表达 `checked_at` snapshot，不把它建模为 live health guarantee。
- [Cloud could expose self-managed configuration before OAuth readiness] → 保持 Cloud new-connect gate 关闭；OAuth change 独立扩展 canonical facade。

## Migration Plan

1. 先落地 provider/candidate/manager completeness 和 create/update/test service tests。
2. 用 concrete routes 和 operation-specific Pydantic contracts 替换 generic item/test routes，并完成 safe error mapping。
3. 在无 live credentials 的 contract tests 中覆盖完整 provider set；真实 provider smoke 保持 opt-in。
4. 该 backend change 可独立部署，但 downstream capability exposure 继续由各自 rollout gate 控制。

## Open Questions

无。
