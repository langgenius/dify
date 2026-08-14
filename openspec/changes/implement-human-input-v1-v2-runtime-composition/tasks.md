## 1. Strict Version Dispatch And Independent Node Class

- [ ] 1.1 添加 red tests，覆盖 missing version、exact `"1"`、exact `"2"`、unsupported string，以及 raw number/boolean/`null`/mapping/list。
- [ ] 1.2 在通用 node-data coercion 前增加 Human Input raw version resolver；非法值统一返回 code 为 `invalid_human_input_node_version` 的 `HumanInputNodeVersionError`，并禁止 unknown version 走 `latest` fallback。
- [ ] 1.3 注册独立 Human Input v2 node class，使用 strict v2 node data 和 exact `version() == "2"`。
- [ ] 1.4 更新 `DifyNodeFactory`，让 v1/v2 binding 分别负责 concrete validation 与 callback construction；v2 不得调用 legacy validation 或 `delivery_methods` adaptation。
- [ ] 1.5 添加 registry/bootstrap regression，证明 v1 published workflow 仍解析到现有 Graphon Human Input node。

## 2. Port-Only V2 Runtime Composition

- [ ] 2.1 定义 version-neutral callback boundary 和 v2 runtime application protocol，使 Node 只依赖 callback、callback 只依赖注入的 runtime capability。
- [ ] 2.2 为 form lifecycle/create-once、recipient runtime snapshot、workspace-contact snapshot、clock、identifier 和 atomic form graph persistence 定义窄接口。
- [ ] 2.3 在 production composition root 注入本 change 已覆盖的 v2 runtime capabilities；保留 `all_workspace_contacts` production snapshot provider 为明确的 deferred wiring point。
- [ ] 2.4 添加 architecture/import tests，禁止 v2 Node/callback 直接依赖 ORM、SQLAlchemy session、Flask/controller、Celery、global database handle、repository implementation 或 service locator。

## 3. Runtime Ownership And Callback Idempotency

- [ ] 3.1 直接更新 schema 与 ORM model 的 runtime owner 定义：删除 `workflow_pause_id`，增加 indexed `workflow_run_id` 和 unique `workflow_node_execution_id`，并更新 runtime-owner check constraint。
- [ ] 3.2 更新 `HumanInputForm`、form creation request、ORM model、mapper、repository 和 tests，使 runtime form 只由 `workflow_run_id + workflow_node_execution_id` 关联 workflow runtime。
- [ ] 3.3 为 runtime owner 实现原子 create-once form operation，事务一次性覆盖 form、grants、endpoints 和 initial delivery attempts。
- [ ] 3.4 添加 callback re-entry tests：已存在且未提交的 form 再次执行时返回相同 form ID，不重复创建任何 form graph object 或 initial attempt。
- [ ] 3.5 添加并发 create tests：相同 workflow node execution 的竞争调用只产生一个 form；loser 加载 winner。
- [ ] 3.6 添加 pause integration test：同一 workflow run 的两个并行 v2 Human Input node executions 创建两个 forms，并可由同一个 workflow pause 保存两个 HITL reasons。

## 4. Runtime `all_workspace_contacts` Expansion

- [ ] 4.1 将 `all_workspace_contacts` marker 适配为 typed runtime recipient specification，并增加 `ALL_WORKSPACE_CONTACTS` matched-source kind。
- [ ] 4.2 定义 immutable workspace-contact snapshot port；每个 current-workspace-scoped candidate 必须携带 canonical Contact、availability 与 workspace-relative `WORKSPACE`/`PLATFORM`/`EXTERNAL` classification。
- [ ] 4.3 在 runtime core 实现纯 expansion/resolution：只选择 available `WORKSPACE` Contacts，排除 `PLATFORM`/`EXTERNAL`，按稳定 Contact ID 顺序展开，并继续走 canonical subject/endpoint dedup。
- [ ] 4.4 添加 tests，覆盖 marker-only、空 workspace、混入 Platform/External、marker + explicit same Contact、multiple markers 和 same-email Contact/EmailAddress 不合并。
- [ ] 4.5 明确记录 production database adapter 与 composition wiring deferred；未 wiring 时必须 fail closed，不能把 marker 解释为空列表。

## 5. Frozen Lifecycle Entry And Compatibility Projection

- [ ] 5.1 添加 v2 callback fake-port tests，证明 waiting reload 使用 frozen runtime owner/state 且不重新解释 authoring recipients 或 endpoints。
- [ ] 5.2 添加 node-timeout 与 global-expiry callback entry tests，证明两者均从 frozen state 进入 `__timeout__`；不实现 scheduler/resume-task wiring。
- [ ] 5.3 从 v2 `HumanInputForm`、form creation request 和 `FormDefinitionProjection` 删除 authoritative `display_in_ui`，并更新 mapper/repository round-trip tests。
- [ ] 5.4 定义并测试 surface-aware derived compatibility projection：SSE/pause `display_in_ui` 只能由 persisted Web/Console endpoint capability 推导；不在本 change 接对外 response consumer。

## 6. Validation And Regression

- [ ] 6.1 运行 node factory、v2 node/callback、recipient resolution、form domain/mapper/repository 和 workflow pause 的 targeted backend tests。
- [ ] 6.2 运行 affected formatter、lint 和 type checks；数据库 integration coverage 按 repository 约定交由 CI。
- [ ] 6.3 验证 legacy v1 node validation、callback、pause/reload、debug/run、published execution 和外部 API payload 全部保持不变。
- [ ] 6.4 运行 `openspec validate implement-human-input-v1-v2-runtime-composition --strict`。
