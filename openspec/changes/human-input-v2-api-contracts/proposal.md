## Why

`humaninput_v2` DSL、领域层、repository 和当前 PRD 已经把 recipient、contact、runtime auth、IM sync 的核心规则收敛到可以落地接口的程度，但现有 Human Input v2 HTTP surface 仍主要是 DTO 与 501 stub：public web form submit 尚未接入 OTP proof，draft `message-template/test` 尚未接入 delivery service，workspace Contact / IM controller 也尚未调用具体业务。继续只维护 contract 而不完成 application service 与 controller wiring，会让已落地的领域能力无法进入连调，并增加 CE / SaaS Flask、EE control-plane 与前端 adapter 各自发明 orchestration 的风险。

## What Changes

- 定义并落地 workspace console API，覆盖 contact 分组、EE 下的 `Platform contact` candidate / add / remove、`External contact` 管理、Email provider、workspace IM override、Organization 级 IM integration 和 manual sync，并明确 `Platform contact` candidate / add 是 EE-only capability，CE / SaaS 可保留实现但允许运行时报 edition-not-supported。
- 落地薄 application service 层与 composition boundary，使 controller 只负责鉴权、DTO 解析、service 调用、response projection 和稳定错误映射，不直接编排多个 repository 或 provider。
- 落地 CE / SaaS 的 workflow draft API，保留现有 `form/preview` 与 `form/run` 路由，并为 v2 接入基于 `DebugChannel` 的 `message-template/test`，同时保持 v1 `delivery-test` contract 不变。
- 落地用户手动确认后批量调用的 Human Input v1 → v2 node-data migration helper API。该 API 只执行 tenant-scoped 批量转换与 blocker 校验；仅当所有节点的新 schema 都生成成功时返回完整结果，只要任一节点生成失败，整个请求就返回错误且不返回部分成功结果。该 API 不持久化 workflow，也不替代前端的批量原子 draft 更新。
- 落地 CE / SaaS 的独立 v2 runtime surface：public Email page 在 `/api` web API namespace 下覆盖 token-based form read、OTP challenge、token-based upload token 和 OTP submit；`workspace contact` / `Platform contact` 使用独立 authenticated page，并通过 `/console/api/form/human-input/<form_token>` 提交。两类页面不得复用 submit controller、request DTO 或 auth guard，也不得跨 surface 使用 token、grant 或 proof；现有 v1 下划线路径、完整 v1 node model 与提交逻辑保持不变，v1 / v2 token 也不得跨版本读取或提交。
- 以 `implement-im-contact-sync-api` 作为 CE / SaaS IM provider、sync application service 与 IM controller wiring 的实现 owner；本 change 负责复用其稳定 service boundary 并验证完整 HTTP contract。
- 以 `implement-ee-human-input-admin-api` 作为 EE Organization control-plane 的实现 owner；本 change 负责 Dify workspace console 到 enterprise control-plane 的 edition-aware adapter 与 contract verification。
- 固定 transport 约束：runtime noun 继续使用 `form`，URL segment 统一使用 `human-input`，Request / Response 统一使用 Pydantic model，优先复用现有 DSL / runtime enum。
- 输出一份根目录汇总 markdown，汇总 Flask View contract、Pydantic DTO、EE proto 章节与必须修正的 DSL 细节。

## Capabilities

### New Capabilities
- `human-input-console-management-api`: workspace console 上的 contact、IM integration、manual sync、draft preview、message template test 与手动 node-data migration helper API contract。
- `human-input-runtime-form-api`: public web 与 service API 上的 form read、OTP challenge、token-based upload token 与 submit-time verification contract。
- `human-input-ee-admin-api`: EE 管理后台的 Organization 级 IM integration / sync 与 Organization Contact IM binding protobuf / `google.api.http` contract。

### Modified Capabilities
- 无。

## Impact

- `api/controllers/console/app/workflow.py`
- `api/controllers/console/human_input_form.py`
- `api/controllers/console/workspace/`
- `api/controllers/web/human_input_form.py`
- `api/controllers/web/human_input_file_upload.py`
- `api/controllers/service_api/app/human_input_form.py`
- `api/services/human_input_v2/*`
- `api/tests/unit_tests/controllers/*/human_input*`
- `api/tests/unit_tests/services/human_input_v2/*`
- `openspec/changes/add-human-input-v2-migration-ui/design.md`
- `openspec/changes/implement-im-contact-sync-api/`
- `openspec/changes/implement-ee-human-input-admin-api/`
- `~/workspace/langgenius/dify-enterprise/server/pkg/apis/enterprise/v1/`
- `/Users/qg/.codex/worktrees/5ab7/dify/human-input-v2-api-summary.md`
