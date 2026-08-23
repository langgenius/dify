## 1. Strict Version Dispatch And Independent Node Class

- [ ] 1.1 添加 red tests，覆盖 missing version、exact `"1"`、exact `"2"`、unsupported string，以及 raw number/boolean/`null`/mapping/list。
- [ ] 1.2 在通用 node-data coercion 前增加 Human Input raw version resolver；非法值统一返回 code 为 `invalid_human_input_node_version` 的 `HumanInputNodeVersionError`，并禁止 unknown version 走 `latest` fallback。
- [ ] 1.3 注册独立 Human Input v2 node class，使用 strict v2 node data 和 exact `version() == "2"`。
- [ ] 1.4 更新共享 `DifyNodeFactory`，只为 exact v2 选择新的 node class、strict validation 与 callback construction；missing/exact v1 必须继续走现有 legacy construction path，不得新增 v1 binding、adapter 或 runtime application。
- [ ] 1.5 添加 registry/bootstrap regression，证明 v1 published workflow 仍解析到现有 Graphon Human Input node。
- [ ] 1.6 添加 v1 scope regression，证明 missing/exact v1 不调用任何 v2 runtime protocol 或 `RuntimeFormProvisioner`，并在 implementation review 中确认未修改 v1 node data、node class、callback、repository、delivery、submission、controller 或 task implementation。

## 2. Port-Only V2 Runtime Composition

- [ ] 2.1 定义 version-neutral callback boundary 和 `HumanInputV2Runtime.enter` protocol，使 Node 只依赖 callback、callback 只构造 runtime entry request 并映射 runtime outcome。
- [ ] 2.2 定义 `RuntimeFormReader`、`RuntimeFormProvisioner.provision` 和 post-commit `FormDeliveryScheduler.schedule(form_ref)`；callback/runtime 不得接收 persistence result、`FormCreation`、delivery command、Worker state 或 delivery outcome。
- [ ] 2.3 实现 `RuntimeFormProvisioner` application composition，使其内部读取 recipient snapshots、调用 `RecipientResolver`、构造不含 runtime attempts 的既有 `FormCreation`、持久化已确认缺失的 form/grant/endpoint graph，并在 commit 后 schedule delivery。
- [ ] 2.4 在 production composition root 注入 `HumanInputV2Runtime`、runtime form reader、`RuntimeFormProvisioner` 和复用既有 asynchronous delivery capability 的 scheduler；不修改 provider adapter 或 worker 的发送语义。
- [ ] 2.5 添加 architecture/import tests，禁止 v2 Node/callback 直接依赖 ORM、SQLAlchemy session、Flask/controller、recipient snapshot adapter、scheduler implementation、Worker、Celery、global database handle、repository implementation 或 service locator。

## 3. Runtime Ownership And Callback Idempotency

- [ ] 3.1 直接更新 schema 与 ORM model 的 runtime owner 定义：删除 `workflow_pause_id`，增加 indexed `workflow_run_id` 和 unique `workflow_node_execution_id`，并更新 runtime-owner check constraint。
- [ ] 3.2 添加 immutable `RuntimeFormOwner` 并更新 `HumanInputForm`、form creation request、ORM model、mapper、repository 和 tests；runtime form 必须有完整 owner，delivery-test form 必须没有 owner。
- [ ] 3.3 为 runtime owner 实现 missing-form create operation：调用前 runtime entry 必须已确认 owner 没有 form；一个 transaction 必须提交 form、grants 和 endpoints，任一写入失败时全部回滚；该 transaction 不创建 delivery attempts。
- [ ] 3.4 添加 callback/runtime re-entry tests：已存在且未提交的 form 再次执行时返回相同 form ID，并且 `HumanInputV2Runtime` 不调用 `RuntimeFormProvisioner`。
- [ ] 3.5 添加 serialized-entry tests：同一个 workflow node execution 的 callback 不并发进入 runtime；entry-start owner read 命中 existing 时不 provision，命中 absent 时只 provision 一次；unexpected unique conflict 作为 invariant violation 传播。
- [ ] 3.6 添加 provisioner/async-delivery tests：scheduler 只在 form transaction commit 后调用；provisioner 不等待 delivery result；Worker 自己创建/更新 attempt 并持久化 outcome；scheduling 或 delivery failure 不改变 waiting Form lifecycle、callback decision，也不新增 form-level sending status。
- [ ] 3.7 更新 submission/resume identity 与 integration tests：同一 workflow run 的两个并行 forms 可由同一个 pause 保存两个 HITL reasons；同一个 `SubmissionTransaction` 在 authorized submission commit 前验证 persisted form owner、active pause 和 matching pause reason，并拒绝 cross-run/form mismatch。

## 4. Frozen Lifecycle Callback Entry

- [ ] 4.1 添加 v2 callback/runtime fake-port tests，证明 waiting reload 使用 frozen runtime owner/state、不调用 `RuntimeFormProvisioner`，且不重新解释 authoring recipients、form blocks、actions 或 endpoints。
- [ ] 4.2 实现并测试 submitted callback entry：仅使用 persisted `selected_action_id`、`input_snapshot`、`canonical_values` 和 frozen form definition 返回 `Completed`。
- [ ] 4.3 添加 node-timeout 与 global-expiry callback entry tests：node timeout 从 frozen state 进入 `__timeout`；global expiry re-entry 作为 invalid resume 被拒绝且不产生 branch selection。不实现 scheduler、workflow-stop 或 resume-task wiring。

## 5. Validation And Regression

- [ ] 5.1 运行 node factory、v2 node/callback/runtime、`RuntimeFormProvisioner`、form domain/mapper/repository、submission/resume correlation 和 workflow pause 的 targeted backend tests。
- [ ] 5.2 运行 affected formatter、lint 和 type checks；数据库 integration coverage 按 repository 约定交由 CI。
- [ ] 5.3 验证 legacy v1 node validation、callback composition、pause/reload、delivery、submission、debug/run、published execution 和外部 API payload 全部保持不变，并确认 application diff 不包含 v1 implementation 修改。
- [ ] 5.4 添加 scope regression：`all_workspace_contacts` 继续通过既有 `UnsupportedRecipientSpecificationError` fail closed，v2 `display_in_ui` aggregate/projection round-trip 保持现状。
- [ ] 5.5 运行 `openspec validate implement-human-input-v2-runtime-composition --strict`。
