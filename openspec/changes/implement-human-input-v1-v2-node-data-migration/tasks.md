## 1. 固定 Contract 与 Ownership

- [ ] 1.1 更新 `api/tests/unit_tests/controllers/common/test_human_input_v2_contracts.py` 的 red tests，覆盖 missing/exact/unsupported version、unknown field compatibility、non-empty batch、duplicate `node_id`、success/failure envelope 和无部分 `data`。
- [ ] 1.2 为 `all_workspace_contacts` 增加 typed recipient representation 与 JSON schema tests，固定 wire shape 为仅含 `type: all_workspace_contacts`，并证明 migration success model 不依赖 `dict[str, Any]`。
- [ ] 1.3 更新 `api/controllers/common/human_input_v2_contracts.py`，使 migration request、result 和 blocker DTO 与修订后 spec 对齐，同时保持现有 frontend adapter 的 `nodes` / `data` correlation shape。
- [ ] 1.4 在 `human-input-v2-api-contracts` 的 implementation checklist 中把旧 tasks 4.1/4.2 标记为由本 change supersede，并记录 Contact-aware conversion 与静态 `whole_workspace` expansion 不得再实现。

## 2. 实现 Pure Node Converter

- [ ] 2.1 在 `api/tests/unit_tests/core/workflow/nodes/human_input_v2/test_migration.py` 添加 red tests，覆盖 external Email 和 member Email 全部输出规范化 `onetime_email`，包括 Contact 状态不影响 output 的 contract case。
- [ ] 2.2 添加 whole-workspace red tests，覆盖单一 typed `all_workspace_contacts` marker、无 member enumeration、与 `initiator` / `onetime_email` overlap 保留以及 marker first-occurrence dedupe。
- [ ] 2.3 添加 delivery mapping red tests，覆盖 WebApp、多个相同/冲突 Email templates、Email debug mode、configured disabled method、unsupported method、invalid configuration、invalid Email、unresolved member 和 missing recipients。
- [ ] 2.4 添加 typed shared-field、source ordering、canonical first-occurrence dedupe、input immutability 和 repeated-conversion determinism red tests。
- [ ] 2.5 在 `api/core/workflow/nodes/human_input_v2/migration.py` 实现 transport-neutral converter 和 immutable result/blocker values，只接受 legacy node value 与 request-local member Email mapping，不导入 Flask、ORM、Contact repository 或 runtime resolver。
- [ ] 2.6 扩充 workflow v2 recipient entities 以表达 migration-only marker，并保持现有 recipient variants 的 serialization 与 validation regression tests；不在本 change 中实现 marker 的 runtime expansion。

## 3. 实现 Tenant-Scoped Member Lookup 与 Batch Service

- [ ] 3.1 在 `api/tests/unit_tests/services/human_input_v2/test_node_data_migration.py` 添加 red service tests，证明整个 batch 只收集一次有序 unique member IDs、只调用一次 lookup、并向所有 node conversions 传入同一 immutable snapshot。
- [ ] 3.2 定义 narrow `WorkspaceMemberEmailLookup` port 和 SQLAlchemy adapter tests，覆盖 `TenantAccountJoin` + `Account` 完整 workspace predicate、不可用 Account、缺失/非法 Email、cross-workspace ID rejection 和 read session 关闭。
- [ ] 3.3 实现只读 lookup adapter，以单次 batch query 返回 member ID 到规范化 Email 的 mapping；不得读取 Contact tables，不得打开 write transaction，也不得调用 `flush` 或 `commit`。
- [ ] 3.4 添加 multi-node red tests，覆盖全部 blocker 聚合、稳定 blocker order、valid-node result discard、全成功 input-order response 和 retry equivalence。
- [ ] 3.5 在 `api/services/human_input_v2/node_data_migration.py` 实现 `HumanInputNodeDataMigrationService`，完成 batch preflight、snapshot load、逐节点 pure conversion 与 all-or-error decision。
- [ ] 3.6 在 `api/services/human_input_v2/composition.py` 增加 migration composition root，将 lookup adapter 注入 service，并用 import-boundary test 防止 controller 或 core converter 直接依赖 ORM。

## 4. 接通 Workspace Console Endpoint

- [ ] 4.1 在 `api/tests/unit_tests/controllers/console/workspace/test_human_input_node_data_migration.py` 添加 red controller tests，覆盖 setup/login/account initialization/edit permission/current tenant enforcement 和 service 未在 authorization failure 时调用。
- [ ] 4.2 添加 HTTP mapping red tests，覆盖 `200` 完整 ordered `data`、`400 hitl_node_data_migration_failure` ordered `blockers`、request validation failure、无 partial data 和 unexpected error 不伪装成 migration blocker。
- [ ] 4.3 替换 `NodeDataMigrationAPI.post` 的 `501` stub，完成 payload validation、service 调用与 response DTO serialization；controller 不得包含 conversion、member query、Contact lookup 或 workflow mutation。
- [ ] 4.4 更新 endpoint schema/docstring，明确所有 legacy Email → `onetime_email`、`whole_workspace` → `all_workspace_contacts`、side-effect-free 和 caller-owned Draft mutation，并保留 generated-client wire compatibility。

## 5. 回归、Rollout Gate 与验证

- [ ] 5.1 添加 service spy/regression tests，证明 success、blocked 和 repeated request 三条路径均不写 workflow、Draft、Published workflow、Contact、task snapshot 或 migration history。
- [ ] 5.2 运行 `uv run --project api pytest api/tests/unit_tests/core/workflow/nodes/human_input_v2/test_migration.py api/tests/unit_tests/services/human_input_v2/test_node_data_migration.py api/tests/unit_tests/controllers/common/test_human_input_v2_contracts.py api/tests/unit_tests/controllers/console/workspace/test_human_input_node_data_migration.py` 并修复失败。
- [ ] 5.3 运行受影响 backend formatter、lint 和 type checks，确认新增 recipient union 的 exhaustive branches、Pydantic schemas 和 service import boundaries 均通过。
- [ ] 5.4 与 WTA-1272 owner 验证 `all_workspace_contacts` runtime resolution contract，并与 frontend correction/migration change 验证 parse、copy/paste、round-trip 和真实 client response；在两者未满足前保持真实 endpoint client rollout disabled。
- [ ] 5.5 删除或改写前端 mock converter 中 Contact auto-upgrade 与 static whole-workspace expansion 的后续任务必须继续由 frontend change 所有；本 change 只记录 generated-client handoff evidence，不修改 frontend orchestration。
- [ ] 5.6 运行 `openspec validate implement-human-input-v1-v2-node-data-migration --strict`，并记录 targeted test commands、rollout dependency 和 remaining CI-only integration coverage。
