## 1. Provider Management 契约与失败测试

- [ ] 1.1 盘点 canonical `ChannelProvider`、provider-specific candidate models、handler registry、IM credential owners、adapter construction、Workspace DTOs 与当前 unavailable handler placeholders。
- [ ] 1.2 添加失败的 provider/candidate contract tests，覆盖 Resend、Slack、Feishu、Lark、DingTalk、Microsoft Teams、WeCom、discriminator/payload mismatch 以及 provider-specific secret replacement rules。
- [ ] 1.3 添加失败的 registry tests，证明 production composition 包含七个完整 `(kind, provider)` entry，且当前 IM provider 均不存在 unavailable placeholder。
- [ ] 1.4 添加失败的 save/test tests，覆盖 persistence 前 external validation、configuration 与 connected diagnostic 原子持久化、standalone test 无持久化以及 failed save 不修改现有状态。

## 2. Canonical Provider 与 Candidate 完整性

- [ ] 2.1 扩展 `ChannelProvider` 和 discriminated command/candidate unions，纳入全部当前 canonical IM provider values，并保持 `feishu` 与 `lark` 可独立寻址。
- [ ] 2.2 在既有 credential owner 中实现 provider-specific DTO-to-credential command mapping；仅当 protected current-secret merge 已受支持时接受 preserve-secret directive。
- [ ] 2.3 为所有当前 provider 完成 safe channel views 与 operation envelopes，禁止暴露 credential、protected placeholder、provider payload 或 raw provider error。

## 3. IM Handler 与 Connectivity 持久化

- [ ] 3.1 替换 Feishu/DingTalk unavailable handlers，并增加 Lark、Microsoft Teams 与 WeCom handlers；复用既有 IM Control Plane 和 provider adapter construction dependencies。
- [ ] 3.2 在 database transaction 外执行 credential authentication、required directory scope validation 与 provider tenant identity resolution，只把 credential-free validated metadata 交给 persistence。
- [ ] 3.3 在一个显式 transaction 中持久化 accepted configuration transition、connected diagnostic 与 trusted `last_checked_at`，并确保 `config_version` 只推进一次。
- [ ] 3.4 保持 standalone candidate test 无持久化，并保证任何 validation/persistence failure 都不修改 credentials、diagnostics、revisions、identities 或 bindings。
- [ ] 3.5 添加 architecture tests，证明 management handlers 不调用 `directory.read_directory()`，也不引入第二套 provider directory client、pagination pipeline、normalization path 或 sync-specific credential model。

## 4. Workspace Console Composition

- [ ] 4.1 为全部 provider-specific management commands 与 credential-free current views 添加严格 Pydantic request/response/error models。
- [ ] 4.2 将 Workspace Channels controllers 与 production composition 接到 `HumanInputChannelManagementService` 和完整 handler registry。
- [ ] 4.3 将 controllers 限制为 authorization、trusted management context construction、DTO mapping 与 stable safe error translation，并为该边界添加 import/call-graph regression coverage。
- [ ] 4.4 添加 controller contract tests，覆盖 list/get/test/save/delete、unsupported reference、stale configuration revision、safe provider failure 与 refreshed authoritative view。

## 5. 后端验证与发布

- [ ] 5.1 为 Slack、Feishu/Lark、DingTalk、Microsoft Teams 与 WeCom 添加 provider-family adapter construction 和 credential round-trip coverage，且不依赖 live credentials。
- [ ] 5.2 添加 PostgreSQL integration coverage，覆盖 create、reconfigure、delete、connected diagnostics、failed validation rollback、single-active Integration、provider replacement 与 unaffected identity/binding invariants。
- [ ] 5.3 添加 security regression tests，证明 responses、logs、metrics 与 traces 不含 credentials 或 raw provider failures。
- [ ] 5.4 运行 focused backend unit suites、controller/schema checks、formatter、type/lint checks 与 `openspec validate complete-human-input-im-channel-management --strict`。
- [ ] 5.5 在 Contact initialization、lifecycle maintenance 与 manual-sync runtime readiness 分别完成前保持 production exposure gated；Slack OAuth lifecycle 继续由既有 change owner 负责。
