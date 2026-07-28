## 1. Directory reader adapters

- [ ] 1.1 为 `IMDirectoryReader` contract 编写失败测试，覆盖 complete pagination、provider user ID、normalized email、bounded fields 与 safe provider errors。
- [ ] 1.2 定义只输出 `ProviderDirectoryEntry` 的 Sync-owned `IMDirectoryReader`，并禁止 connection test、tenant confirmation、credential 或 SDK model 越界。
- [ ] 1.3 为 Feishu、Lark 与 DingTalk 实现 directory adapters，通过 Foundation provider-local client lifecycle 读取目录，不复制 credential/client factory。
- [ ] 1.4 增加共享 provider directory contract suite，验证三类 adapter 的 normalization、pagination、rate-limit/error mapping 与 sensitive-data redaction。

## 2. Manual sync application service

- [ ] 2.1 为纯 Sync `IMSyncService` 编写失败测试，覆盖 manual trigger、active-run reuse、latest summary/result query 与 Foundation current revision dependency。
- [ ] 2.2 实现 manual sync command/query service，只拥有 run lifecycle，不包含 Integration read/configure/delete/test commands。
- [ ] 2.3 实现异步 worker，按顺序加载 captured revision、调用 `IMDirectoryReader`、加载 snapshot、运行 `SyncReconciler` 并 revision-guarded apply。
- [ ] 2.4 覆盖 provider fetch failure、stale revision、reconcile/apply failure 与 worker retry，确保 run 总能进入 terminal state 且不错误修改 current identities/bindings。
- [ ] 2.5 保持 latest-only 与 `added / not_matched / failed / removed / skipped` canonical result contract，并验证 pagination/filter rejection。

## 3. Contact binding integration

- [ ] 3.1 为 `ContactIMBindingService` 编写失败测试，覆盖 synced identity search、Contact type gate、binding/override separation 与 effective resolution。
- [ ] 3.2 实现按 provider user ID、display name 与 email 搜索 synced IM identities。
- [ ] 3.3 实现 contact-scoped organization binding create/delete，只允许 current `WORKSPACE` 或 `PLATFORM` Contact。
- [ ] 3.4 实现支持 edition 的 workspace override set/reset，并保持 `workspace override > organization binding > Email fallback`。
- [ ] 3.5 验证 unmatched result 不自动创建 Contact/binding，且 Integration replacement 后 invalid binding 不再进入 effective resolution。

## 4. Transport-neutral composition boundary

- [ ] 4.1 为 `IMSyncService` 与 `ContactIMBindingService` 暴露显式 service factories 和 composition entry points，注入 Foundation current Integration/client boundary、repositories、worker enqueue port、clock 与 edition policy。
- [ ] 4.2 定义稳定的 transport-neutral command/query/result/error boundary，确保 workspace 与 trusted internal API consumers 不直接编排 repositories、provider adapters 或 worker。
- [ ] 4.3 增加 API-consumer contract fixtures，覆盖 manual trigger、latest summary/result、identity search、binding 与 override；fixtures 不包含 Flask、Pydantic、caller auth/scope 或 HTTP mapping。
- [ ] 4.4 将 composition boundary 交付给 `human-input-v2-api-contracts`；该 change 独占 workspace/internal handlers、route wiring、controller tests 与 IM 501 replacement。

## 5. Verification and architecture boundaries

- [ ] 5.1 增加 repository/service/worker tests，覆盖 concurrent trigger、stale apply、latest-result filter、identity search、binding writes 与 override reset。
- [ ] 5.2 增加 architecture tests，禁止 Sync 解密 credential、创建 provider client、运行 webhook/stream transport或调用 EE Human Input API。
- [ ] 5.3 验证 manual sync implementation 完整调用链只在 Dify 内执行，application modules 不导入 Flask/internal controller 或 EE transport，并且没有 parallel EE worker/provider/repository。
- [ ] 5.4 运行 targeted unit、repository、service/worker、provider contract 与 concurrency test commands，并修复 typing、lint 与 coverage gaps；transport call-graph/controller tests 留在 `human-input-v2-api-contracts`。
