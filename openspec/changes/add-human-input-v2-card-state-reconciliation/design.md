## Context

Human Input v2 当前存在三个彼此正确但尚未被 application orchestration 连接的边界：

- `human-input-v2-submission-runtime` 负责 authorization、first-success transaction、submission commit 和 commit 后 workflow resume；Form lifecycle owner 另外负责 node timeout 与 expiry transition；
- `HumanInputForm`、endpoint 与 delivery attempt 保存 Form-scoped lifecycle 和 delivery facts；
- `IMDynamicCardMessaging` 负责 `send_card`、opaque `MessageLocator` 和 `replace_with_static` 的 Provider-neutral primitive。

`IMCardEventDecoder` 有意停止在 HITL authorization 之前，也不携带 message locator。这个边界应保持不变：callback 只需要定位 Form、action 和 actor，card replacement 不应绑定到触发 submission 的单个 callback card。

正确的 reconciliation scope 是已进入 committed terminal outcome 的 `HumanInputForm` 的全部 confirmed dynamic-card deliveries。Terminal outcome 包括 accepted selected-action submission（包含业务 rejection action）、node timeout 与 expiry。每个 accepted `send_card` 结果都是独立 card instance，即使它与其他 card 共享 endpoint、Provider identity 或 handling history。Application orchestration 必须在 terminal transition 成功 commit 后为每个实例调用既有 Provider primitive，并把业务结果与卡片更新结果分开保存。

## Goals / Non-Goals

**Goals:**

- 建立独立于 workflow node runtime、submission transaction 和 IM Provider abstraction 的 card-state reconciliation application capability。
- 对一次 committed submission、node-timeout 或 expiry outcome 覆盖该 Form 的全部 accepted dynamic card instances。
- 正确处理 card acceptance 与 Form handling commit 的并发竞争，不遗漏在途 card delivery。
- 保证 Provider I/O 只发生在 business commit 之后，并且每个 card target 至多调用一次 Provider mutation。
- 保存 per-card operational outcome，同时保持 Form lifecycle、submission result 和 workflow progress 不变。
- 保持 locator opaque、Provider/tenant compatibility validation 和 exact-message mutation 位于现有 IM capability 内。

**Non-Goals:**

- 不把 reconciliation 编排加入 `HumanInputForm` aggregate、workflow node runtime 或 `human-input-v2-submission-runtime` domain logic。
- 不修改 `IMProviderAdapter`、`IMDynamicCardMessaging`、`MessageLocator` 或 `IMCardEvent` 的公共 contract。
- 不让 callback event 携带或选择 message locator。
- 不引入 Provider mutation retry、backoff、second submission attempt 或 compensation。
- 不改变 `HumanInputForm` 现有 submitted、timed-out 与 expired lifecycle vocabulary，也不为卡片 reconciliation 引入新的 Form status。
- 不新增 public API 或改变现有 submission response、workflow node data 和 callback DTO。

## Decisions

### 1. 使用聚焦的 Form card reconciliation application service

新增 capability 使用独立 application service，而不是扩展 submission runtime 或建立通用 post-commit god orchestrator。依赖方向固定为：

```text
HITL application handler / lifecycle callback
    -> terminal transition transaction
    -> committed Form terminal outcome
    -> card reconciliation port
    -> Provider-neutral adapter capability
```

Submission runtime 继续决定并持久化 accepted selected-action submission；Form lifecycle owner 继续决定并持久化 node timeout 与 expiry。Reconciler 只消费已经 committed 的 terminal outcome。Provider boundary 只接收 compatible adapter、opaque locator 和 `StaticCardIntent`。

备选方案及拒绝理由：

- 将 fan-out 放入 `human-input-v2-submission-runtime`：会让 transaction/authorization capability 感知 IM delivery enumeration、Provider I/O 和 operational outcomes。
- 将 fan-out 放入 workflow node runtime：node callback 不是 public/IM submission 的唯一入口，也不拥有 submission commit。
- 将 Form 语义放入 IM Provider specs：会反转依赖方向并泄漏 HITL aggregate、workflow 和 persistence 概念。
- 按 handled callback 选择单个 locator：只能更新触发交互的 card，违反 Form-scoped all-card requirement。

### 2. Card instance 以 confirmed send result 标识

每个成功 `send_card` delivery attempt 必须保存：

- `tenant_id`、`form_id`、`endpoint_id` 和 `delivery_attempt_id`；
- frozen `integration_id`、Provider 和 Provider-tenant context；
- `MessageAccepted.locator` 的原始 scalar value；
- Provider acceptance timestamp。

一个 accepted delivery attempt 对应一个 card instance。Reconciliation 不按 endpoint、Provider、Provider identity 或 locator 内容去重，也不解析 locator。没有 confirmed locator 的 failed/unknown initial send 不产生 target。

复用 existing delivery attempt 作为 initial-send fact；不要把 later replacement outcome 写回 initial delivery status，因为二者是不同阶段的 operational state。

### 3. 使用独立且 durable 的 per-card reconciliation target

新增持久化 record，例如 `HumanInputV2CardReconciliationTarget`，至少保存：

- stable target ID；
- `tenant_id`、`form_id`、`delivery_attempt_id` 和 `endpoint_id`；
- immutable Provider/tenant/Integration context 和 locator snapshot；
- controlled status；
- sanitized terminal reason and timestamps。

数据库必须对 `(tenant_id, form_id, delivery_attempt_id)` 建立 unique constraint。初始与终态建议为：

```text
PENDING
ATTEMPTING
SUCCEEDED
UNSUPPORTED
INVALID_REFERENCE
STALE_REFERENCE
UNKNOWN
```

这些状态是 replacement operational state，不是 Form lifecycle。`INVALID_REFERENCE`、`STALE_REFERENCE` 和 `UNKNOWN` 与 existing `ReplacementErrorKind` 一一映射；adapter/capability resolution failure 在没有 Provider mutation 时安全映射到 `UNSUPPORTED` 或 `UNKNOWN`，并记录 sanitized diagnostic。

备选方案是复用 `HumanInputV2FormDeliveryAttempt.status`。该方案被拒绝，因为 initial send 的 `SENT` 与 later replacement failure 可以同时成立，把两阶段压进一个 status 会丢失真实状态并破坏 append-oriented delivery history。

### 4. 在业务事务内 materialize intent，在事务外执行 Provider I/O

每个 accepted submission、node-timeout 或 expiry transition transaction 必须在提交 Form terminal outcome 的同一数据库事务中，为当时已存在的全部 accepted card deliveries create-or-load reconciliation targets。事务内只写 durable intent，不构造 adapter、不读取 credentials，也不执行 Provider I/O。

事务 commit 后，publisher/worker 才能看到 `PENDING` targets。Workflow resume enqueue 与 reconciliation 是同一 committed outcome 的独立后置效果；二者互不等待，也不互相回滚。

这要求 submission persistence 与 timeout/expiry transition application boundaries 复用一个窄的 target-materialization collaborator，但 submission domain、Form lifecycle decision 和 public handler 不导入 Provider contract 或 reconciliation aggregate。

### 5. 使用 Form row serialization 解决 late card acceptance race

Terminal transition commit 与 `send_card` acceptance persistence 都必须以相同顺序锁定 Form owner row，再检查当前 Form state：

- delivery acceptance 先完成：terminal transition transaction 会枚举它并创建 target；
- terminal transition commit 先完成：delivery acceptance transaction 发现 Form 已 submitted、timed out 或 expired，并为新 accepted card create target；
- 两者竞争：Form row serialization 决定顺序，unique constraint 保证 target create-once。

如果 initial send 已在 Provider 成功但本地 acceptance persistence 失败，现有 send contract 不允许盲目重放创建；该 delivery 没有 durable confirmed locator，因而不能安全参与 reconciliation。

### 6. 每个 target 使用自己的 context，Provider 层继续验证 compatibility

Worker 按 target 的 frozen Integration/Provider/tenant facts 取得 compatible adapter，并读取 optional Dynamic Card Messaging capability：

- capability absent：记录 `UNSUPPORTED`，不执行 Provider mutation；
- capability present：从 committed Form snapshot 渲染无交互元素的 `StaticCardIntent`，将 target 保存的 locator 原样传入 `replace_with_static`；
- success：记录 `SUCCEEDED`；
- typed error：记录对应 terminal status；
- locator 不匹配、损坏或 stale：完全服从 Provider capability 的 existing validation 和 no-fallback contract。

Reconciler 不通过 callback 寻找 locator，也不替 Provider 检查 private payload。不同 target 独立执行；一个 target 失败不得短路剩余 targets。

### 7. Provider mutation 是 at-most-once，当前没有业务 retry

Repository 使用 compare-and-swap claim 将一个 target 从 `PENDING` 变为 `ATTEMPTING`。只有 winning worker 可以执行 Provider I/O。Duplicate task 在 claim 失败后直接结束。

`PENDING` task 在尚未 claim 前可以重复发布；这只是 durable work delivery，不是 Provider mutation retry。一旦进入 `ATTEMPTING`，target 永不返回 `PENDING`：

- 正常结果进入对应 terminal status；
- worker 在 Provider call 后丢失结果或 `ATTEMPTING` 超时，由 recovery 标记 `UNKNOWN`；
- recovery 不再次调用 Provider。

Celery task 不启用 application retry，typed Provider failure 不产生新 target，也不重新执行 submission。未来若需要 retry，必须以新的 OpenSpec correction 定义 mutation identity、uncertain outcome policy 和 operator controls。

### 8. Static presentation 只从 committed Form terminal facts 渲染

所有 target 的静态 presentation 必须从同一个 committed Form definition、terminal lifecycle outcome 和 frozen display facts 确定性渲染。对于 submitted Form，presentation 必须反映 committed selected action，包括业务 rejection action；对于 timed-out 或 expired Form，presentation 必须反映对应 terminal state，并且不得伪造 selected action。Provider-specific layout 仍由 adapter 处理，application intent 只包含 Provider-neutral CommonMark static content，不包含 interactive inputs、actions 或 callback metadata。

本 change 不要求所有 Provider 生成 byte-identical native payload，只要求它们反映同一个 committed Form terminal outcome。

### 9. Business state 与 operational state 分开读取

Form status 是唯一 authoritative handling result。Card reconciliation status 只能回答某个 card instance 是否成功变成静态展示。

Application/read model 必须支持按 Form 查询 targets，以表达 partial success，并同时保留 `SUBMITTED`、`TIMED_OUT` 或 `EXPIRED` 业务状态。例如：

```text
Form: SUBMITTED
Card A: SUCCEEDED
Card B: STALE_REFERENCE
Card C: UNKNOWN
```

Reconciliation terminal outcome 不更新 Form status，不撤销 submission record，不改变 timeout/expiry decision，也不阻止或补偿 workflow resume 或 timeout branch dispatch。Public API 暂不暴露这个 projection；repository/application projection 与 operator diagnostics 为后续 API 保留稳定边界。

## Risks / Trade-offs

- [Provider call at-most-once means crash ambiguity becomes terminal `UNKNOWN`] → 明确牺牲自动恢复以遵守当前 no-retry 决策和 uncertain mutation safety；记录 operator-safe diagnostic。
- [Form commit 与 late card acceptance 可能遗漏 target] → 两个事务统一锁定 Form owner row，并使用 `(form_id, delivery_attempt_id)` uniqueness 覆盖所有序列化顺序。
- [Large Forms may have many card instances] → 一 target 一 task/claim，按 stable target ID 分页发布；不要在 submission transaction 中执行 Provider I/O。
- [Integration was removed or credentials changed before reconciliation] → 使用 frozen Provider/tenant identity 做 compatibility guard，使用 current authorized adapter resolution；无法安全调用时终止为 `UNSUPPORTED` 或 `UNKNOWN`。
- [Operational records increase storage] → 采用 Form-scoped index 和与 delivery history 对齐的 retention policy；不得为了节省空间覆盖 initial delivery facts。
- [Static presentation renderer can drift] → 只读取 frozen Form definition 与 committed outcome，并用 golden tests 固定 Provider-neutral content。

## Migration Plan

1. 添加 accepted IM card delivery data mapping、reconciliation target table、unique/index constraints 和 explicit mappers。
2. 先部署 `send_card` acceptance 的 locator persistence；未能 durable 保存 locator 的历史 send 不参与 reconciliation。
3. 部署 target repository、claim/recovery、deterministic static renderer 和 Provider-neutral worker，保持 publisher disabled。
4. 将 accepted submission、node-timeout、expiry commit 与 IM delivery acceptance persistence 接入 create-or-load target materialization，并添加 concurrency tests。
5. 启用 publisher/worker；只处理 feature rollout 后进入 submitted、timed-out 或 expired 状态的 Form 和可恢复 locator 的 accepted cards，不回填已完成的历史 Form。
6. 回滚时停止 target materialization 和 worker publication；保留 existing Form outcome、delivery attempts 和 reconciliation diagnostics，不回滚已完成的 Provider replacement。

## Open Questions

None.
