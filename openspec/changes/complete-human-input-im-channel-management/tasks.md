## 1. Provider Management 契约与失败测试

- [ ] 1.1 盘点 canonical `ChannelProvider`、provider-specific candidate models、`ChannelHandler`/`ChannelHandlerRegistry` call sites、IM credential owners、adapter construction、Workspace DTOs 与当前 unavailable provider placeholders。
- [ ] 1.2 添加失败的 provider/candidate contract tests，覆盖 Resend、Slack、Feishu、Lark、DingTalk、Microsoft Teams、WeCom、operation-specific create/update/test commands、三个 operation 的 complete-candidate parity 和 nullable-field rules。
- [ ] 1.3 添加失败的 composition/architecture tests，证明 concrete routes 和固定 product-order collection 分别绑定七个完整 `(kind, provider)` manager，且 production code 不再导入、构造或调用 `ChannelHandler`、`ChannelHandlerRegistry`、`DuplicateChannelHandlerError`。
- [ ] 1.4 添加失败的 create/update/test tests，覆盖 create/update state preconditions、完整 CAS、`replace_current` authorization、persistence 前 external validation、configuration 与 connected diagnostic 原子持久化、connection test 不读取 persisted credentials，以及 failed mutation 不修改现有状态。

## 2. Canonical Provider 与 Candidate 完整性

- [ ] 2.1 扩展 `ChannelProvider` 和 provider-specific create/update/test command/candidate types，纳入全部当前 canonical IM provider values，并保持 `feishu` 与 `lark` 可独立寻址。
- [ ] 2.2 在既有 credential owner 中实现 create/update/test 共用的 complete candidate validation 和 protection；update 不得读取或 merge current credentials，transport 不得接受 `PreserveOriginalValue` 或其他 retention directive。
- [ ] 2.3 为所有当前 provider 完成 safe current views 与 operation envelopes，并为当前 IM providers 提供 common connection-test result；禁止暴露 credential、protected placeholder、provider payload 或 raw provider error。
- [ ] 2.4 删除 `ChannelHandler`、`ChannelHandlerRegistry`、`DuplicateChannelHandlerError` 及其 exports/tests，并从 `HumanInputChannelManagementService` 移除 register/resolve/handlers dispatch；保留 shared safe-result 和 lifecycle orchestration 时必须由 caller 传入已绑定的 concrete provider manager。

## 3. IM Provider Management 与 Connectivity 持久化

- [ ] 3.1 替换 Feishu/DingTalk unavailable provider implementations，并增加 Lark、Microsoft Teams 与 WeCom provider managers；复用既有 IM Control Plane 和 provider adapter construction dependencies。
- [ ] 3.2 在 database transaction 外执行 credential authentication、required directory scope validation 与 provider tenant identity resolution，只把 credential-free validated metadata 交给 persistence。
- [ ] 3.3 在一个显式 transaction 中持久化 accepted configuration transition、connected diagnostic 与 trusted `last_checked_at`，并确保 `config_version` 只推进一次。
- [ ] 3.4 保持 connection test 只使用 submitted complete credentials 且不持久化 configuration state，并保证任何 validation、replacement-authorization 或 persistence failure 都不修改 credentials、diagnostics、revisions、identities 或 bindings。
- [ ] 3.5 添加 architecture tests，证明 provider managers 不调用 `directory.read_directory()`，也不引入第二套 provider directory client、pagination pipeline、normalization path 或 sync-specific credential model。

## 4. Workspace Console Composition

- [ ] 4.1 为 `email/resend` 与每个 `im/<provider>` 添加 concrete POST-create、PUT-update 和 POST-test Pydantic request schemas；三个 operation 复用相同的完整 provider configuration fields，PUT 只增加 CAS/`replace_current` control fields，公开 schema 不包含 provider discriminator 或 `PreserveOriginalValue`。
- [ ] 4.2 用 concrete kind/provider item/test resources 替换 generic dynamic routes，在 composition time 将每个 resource 直接绑定到对应 provider manager；共享 thin controller helpers 不得执行 runtime provider lookup，未知 provider 直接 route-level `404`。
- [ ] 4.3 将 controllers 限制为 authorization、trusted management context construction、DTO mapping 与 stable safe error translation，并为该边界添加 import/call-graph regression coverage。
- [ ] 4.4 添加 controller/OpenAPI contract tests，覆盖 concrete route inventory、create/update/test candidate parity、required secrets、nullable-field clearing、common IM test response、route-level `404`、POST `201`、PUT `200`、`replace_current`、stale configuration revision、safe provider failure 与 refreshed authoritative view。

## 5. 后端验证与发布

- [ ] 5.1 为 Slack、Feishu/Lark、DingTalk、Microsoft Teams 与 WeCom 添加 provider-family adapter construction 和 credential round-trip coverage，且不依赖 live credentials。
- [ ] 5.2 添加 PostgreSQL integration coverage，覆盖 create、update、delete、connected diagnostics、failed validation/authorization rollback、single-active Integration、explicitly authorized provider/provider-tenant replacement 与 unaffected identity/binding invariants。
- [ ] 5.3 添加 security regression tests，证明 responses、logs、metrics 与 traces 不含 credentials 或 raw provider failures。
- [ ] 5.4 运行 focused backend unit suites、controller/schema/OpenAPI checks、formatter、type/lint checks 与 `openspec validate complete-human-input-im-channel-management --strict`；检查 concrete item paths 不含 dynamic kind/provider segment，request schemas 不含 public preserve marker。
- [ ] 5.5 在 Contact initialization、lifecycle maintenance 与 manual-sync runtime readiness 分别完成前保持 production exposure gated；Slack OAuth lifecycle 继续由既有 change owner 负责。
