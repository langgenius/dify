## 1. 固定 Contract 与 Ownership

- [x] 1.1 更新 `api/tests/unit_tests/controllers/common/test_human_input_v2_contracts.py` 的 red tests，覆盖 missing/exact/unsupported version、unknown field compatibility、non-empty batch、duplicate `node_id`、success/failure envelope 和无部分 `data`。
- [x] 1.2 为 `all_workspace_contacts` 增加 typed recipient representation 与 JSON schema tests，固定 wire shape 为仅含 `type: all_workspace_contacts`，并证明 migration success model 不依赖 `dict[str, Any]`。
- [x] 1.3 更新 `api/controllers/common/human_input_v2_contracts.py`，使 migration request、result 和 blocker DTO 与修订后 spec 对齐，同时保持现有 frontend adapter 的 `nodes` / `data` correlation shape。
- [x] 1.4 在 `human-input-v2-api-contracts` 的 implementation checklist 中把旧 tasks 4.1/4.2 标记为由本 change supersede，并记录 Contact-aware conversion 与静态 `whole_workspace` expansion 不得再实现。

## 2. 实现 Pure Node Converter

- [x] 2.1 在 `api/tests/unit_tests/core/workflow/nodes/human_input_v2/test_migration.py` 添加 red tests，覆盖 external Email 和 member Email 全部输出规范化 `onetime_email`，包括 Contact 状态不影响 output 的 contract case。
- [x] 2.2 添加 whole-workspace red tests，覆盖单一 typed `all_workspace_contacts` marker、无 member enumeration、与 `initiator` / `onetime_email` overlap 保留以及 marker first-occurrence dedupe。
- [x] 2.3 添加 delivery mapping red tests，覆盖 WebApp、多个相同/冲突 Email templates、Email debug mode、configured disabled method、unsupported method、invalid configuration、invalid Email、unresolved member 和 missing recipients。
- [x] 2.4 添加 typed shared-field、source ordering、canonical first-occurrence dedupe、input immutability 和 repeated-conversion determinism red tests。
- [x] 2.5 在 `api/core/workflow/nodes/human_input_v2/migration.py` 实现 transport-neutral converter 和 immutable result/blocker values，只接受 legacy node value 与 request-local member Email mapping，不导入 Flask、ORM、Contact repository 或 runtime resolver。
- [x] 2.6 扩充 workflow v2 recipient entities 以表达 migration-only marker，并保持现有 recipient variants 的 serialization 与 validation regression tests；不在本 change 中实现 marker 的 runtime expansion。

## 3. 实现 Tenant-Scoped Member Lookup 与 Batch Service

- [x] 3.1 在 `api/tests/unit_tests/services/human_input_v2/test_node_data_migration.py` 添加 red service tests，证明整个 batch 只收集一次有序 unique member IDs、只调用一次 lookup、并向所有 node conversions 传入同一 immutable snapshot。
- [x] 3.2 定义 narrow `WorkspaceMemberEmailLookup` port 和 SQLAlchemy adapter tests，覆盖 `TenantAccountJoin` + `Account` 完整 workspace predicate、不可用 Account、缺失/非法 Email、cross-workspace ID rejection 和 read session 关闭。
- [x] 3.3 实现只读 lookup adapter，以单次 batch query 返回 member ID 到规范化 Email 的 mapping；不得读取 Contact tables，不得打开 write transaction，也不得调用 `flush` 或 `commit`。
- [x] 3.4 添加 multi-node red tests，覆盖全部 blocker 聚合、稳定 blocker order、valid-node result discard、全成功 input-order response 和 retry equivalence。
- [x] 3.5 在 `api/services/human_input_v2/node_data_migration.py` 实现 `HumanInputNodeDataMigrationService`，完成 batch preflight、snapshot load、逐节点 pure conversion 与 all-or-error decision。
- [x] 3.6 在 `api/services/human_input_v2/composition.py` 增加 migration composition root，将 lookup adapter 注入 service，并用 import-boundary test 防止 controller 或 core converter 直接依赖 ORM。

## 4. 接通 Workspace Console Endpoint

- [x] 4.1 在 `api/tests/unit_tests/controllers/console/workspace/test_human_input_node_data_migration.py` 添加 red controller tests，覆盖 setup/login/account initialization/edit permission/current tenant enforcement 和 service 未在 authorization failure 时调用。
- [x] 4.2 添加 HTTP mapping red tests，覆盖 `200` 完整 ordered `data`、`400 hitl_node_data_migration_failure` ordered `blockers`、request validation failure、无 partial data 和 unexpected error 不伪装成 migration blocker。
- [x] 4.3 替换 `NodeDataMigrationAPI.post` 的 `501` stub，完成 payload validation、service 调用与 response DTO serialization；controller 不得包含 conversion、member query、Contact lookup 或 workflow mutation。
- [x] 4.4 更新 endpoint schema/docstring，明确所有 legacy Email → `onetime_email`、`whole_workspace` → `all_workspace_contacts`、side-effect-free 和 caller-owned Draft mutation，并保留 generated-client wire compatibility。

## 5. 回归、Rollout Gate 与验证

- [x] 5.1 添加 service spy/regression tests，证明 success、blocked 和 repeated request 三条路径均不写 workflow、Draft、Published workflow、Contact、task snapshot 或 migration history。
- [x] 5.2 运行 `uv run --project api pytest api/tests/unit_tests/core/workflow/nodes/human_input_v2/test_migration.py api/tests/unit_tests/services/human_input_v2/test_node_data_migration.py api/tests/unit_tests/controllers/common/test_human_input_v2_contracts.py api/tests/unit_tests/controllers/console/workspace/test_human_input_node_data_migration.py` 并修复失败。
- [x] 5.3 运行受影响 backend formatter、lint 和 type checks，确认新增 recipient union 的 exhaustive branches、Pydantic schemas 和 service import boundaries 均通过。
- [x] 5.4 与 WTA-1272 owner 验证 `all_workspace_contacts` runtime resolution contract，并与 frontend correction/migration change 验证 parse、copy/paste、round-trip 和真实 client response；在两者未满足前保持真实 endpoint client rollout disabled。
- [x] 5.5 删除或改写前端 mock converter 中 Contact auto-upgrade 与 static whole-workspace expansion 的后续任务必须继续由 frontend change 所有；本 change 只记录 generated-client handoff evidence，不修改 frontend orchestration。
- [x] 5.6 运行 `openspec validate implement-human-input-v1-v2-node-data-migration --strict`，并记录 targeted test commands、rollout dependency 和 remaining CI-only integration coverage。

## Rollout Evidence

- Backend migration output now has the exact typed `all_workspace_contacts` marker. The runtime workflow adapter explicitly fails closed with `UnsupportedRecipientSpecificationError` instead of treating the marker as unreachable; WTA-1272 or its explicit successor still owns real runtime expansion.
- Editor parse, copy/paste, and round-trip support remains gated: `web/app/components/workflow/nodes/human-input-v2/types.ts` does not yet include `all_workspace_contacts` in `HumanInputV2Recipient`, and the marker has no frontend implementation occurrence.
- Real-client rollout is still disabled. `web/app/components/workflow/nodes/human-input-v2/migration/provider.tsx` continues to construct `createMockHumanInputMigrationApi(...)`, and no generated `node-data-migration` client is present under `web/service/`.
- `add-human-input-v2-migration-ui` task 2.8 continues to own generated-client replacement and mock-converter removal. `align-human-input-specs-with-prd-corrections` tasks 2.2/2.3 continue to own editor preservation and compatibility-overlap behavior. This backend change does not modify frontend orchestration.

## Verification Results

- 五个 targeted migration/runtime suites 共 65 个测试通过，其中包含真实 frontend `user_id` member shape、非 Email delivery compatibility payload、强制 `human-input` output 和 runtime typed fail-closed marker handling；schema/Swagger regression 另有 49 个测试通过。
- Branch-aware scoped coverage 覆盖 `core.workflow.nodes.human_input_v2.migration`、`services.human_input_v2.node_data_migration`、`services.human_input_v2.workspace_member_email_lookup` 和 `services.human_input_v2.composition`，28 个测试的 aggregate coverage 为 90.14%，各模块分别为 89%、98%、93% 和 68%。
- Scoped Ruff format/check 通过。Affected Pyrefly 覆盖 contracts/controller、recipient entities、converter、service/composition/lookup 和 runtime adapter，结果为 0 errors、4 个已有或 Pydantic boundary 明确说明的 suppressions。
- Response-contract lint 对目标 controller 报告 1 valid、0 mismatch、0 refactorable、27 unknown；generated Console OpenAPI 包含 migration request schema 及 typed 200 success/400 failure response。Strict OpenSpec validation 通过，26/26 tasks 保持 evidence-backed。
- `api/AGENTS.md` 约定的 Docker-backed backend integration coverage 仍由 CI 负责；本 change 没有 database migration 或需要新增本地 integration environment 的 write path。
