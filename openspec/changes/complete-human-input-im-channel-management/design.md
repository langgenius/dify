## Context

Canonical Channel Management 已为 Resend 和 self-managed Slack 提供完整 operation，Feishu/DingTalk 仍使用 unavailable handlers，Lark、Microsoft Teams 和 WeCom 尚未进入 provider/candidate union。底层 IM Control Plane 与现有 provider adapters 已覆盖这些 provider family；缺口在 management contract、credential validation/persistence wiring 和 safe Console mapping，而不是 directory synchronization。

本 change 只完成 backend configuration lifecycle。Manual sync runtime、OAuth lifecycle 和 provider directory read 由其他 owner 负责。

## Goals / Non-Goals

**Goals:**

- 让 Resend 和当前完整 IM provider set 通过同一 canonical management facade 暴露。
- 保持 provider-specific typed candidates、credential owner 和 Integration CAS invariants。
- 让 successful IM save 产生可持久化、credential-free 的 connected diagnostic。
- 保持 controller 为 thin transport adapter。

**Non-Goals:**

- 不读取 provider directory，不实现 reconciliation 或 Celery dispatch。
- 不新增 credential schema，除非 existing adapter contract test 证明必要。
- 不实现 Slack OAuth authorize/callback/token lifecycle。
- 不实现 EE transport。

## Decisions

### 1. Register one handler per complete channel reference

Registry 使用完整 `(kind, provider)` key，每个 canonical provider value 拥有一个 handler entry。`feishu` 和 `lark` 分别 addressable，但共享 provider-family dependencies。这样 registry 不需要理解 family dedup，caller 也不会收到不完整 reference。

按 provider 分多个 change 会反复修改 enum、candidate union、registry 和 transport schema，产生 change amplification，因此完整 provider set 在同一 owner 中完成。

### 2. Preserve provider-specific candidate types

Save/test command 使用 discriminated provider-specific candidate，而不是 untyped configuration map。Candidate-to-existing-credential mapping 在原 credential owner 处完成；只有 concrete port 支持 protected current-secret resolution/merge 时才接受 preserve directive，否则必须提供新 secret。

### 3. Validate provider connectivity before opening the persistence transaction

Credential authentication、required-scope validation 和 provider tenant identity resolution 属于 external I/O，必须在 database transaction 外完成。Validated result 返回 credential-free metadata；manager 随后在一个 explicit transaction 中应用 configuration transition 与 connected diagnostic。

把 provider I/O 放入 transaction 会扩大 lock duration；让任一调用方从 submitted candidate 推断 connected state 会使其本地状态超前于 persisted facts，因此均拒绝。

### 4. Save persists configuration and diagnostics atomically

Create/reconfigure 成功时，configuration transition 推进 `config_version` 一次，`record_diagnostics(CONNECTED, checked_at, safe_metadata)` 与其同 transaction 持久化但不再次推进 version。Failed validation 在进入 write transaction 前结束，不能修改 current state。Standalone test 返回 `ChannelTestResult`，不写 diagnostics。

### 5. Management reuses existing adapters without owning directory reads

Management handler 可以复用 existing provider adapter 的 credential validation/tenant identity capability，但不得调用 `directory.read_directory()`，也不得新增 provider directory HTTP client、pagination 或 normalization。Directory ownership 保持在 sync worker 的 `IMProviderAdapter` path。

### 6. Controllers map trusted context into the facade

Workspace Console controller 只构造 trusted management context、解析 Pydantic DTO、调用 `HumanInputChannelManagementService` 并映射 stable safe errors。Repository、credential protector、provider adapter 和 provider payload 不得上浮到 controller。

## Risks / Trade-offs

- [Provider credential contracts differ] → 使用 discriminated commands 和 provider-specific tests，禁止 generic credential map。
- [Validation succeeds but provider state changes before commit] → persisted diagnostic 表达 `checked_at` snapshot，不把它建模为 live health guarantee。
- [Cloud could expose self-managed configuration before OAuth readiness] → 保持 Cloud new-connect gate 关闭；OAuth change 独立扩展 canonical facade。

## Migration Plan

1. 先落地 provider/candidate/handler completeness 和 service tests。
2. 完成 Pydantic contracts、controller composition 和 safe error mapping。
3. 在无 live credentials 的 contract tests 中覆盖完整 provider set；真实 provider smoke 保持 opt-in。
4. 该 backend change 可独立部署，但 downstream capability exposure 继续由各自 rollout gate 控制。

## Open Questions

无。
