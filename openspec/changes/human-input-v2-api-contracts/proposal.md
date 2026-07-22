## Why

`humaninput_v2` DSL 和当前 PRD 已经把 recipient、contact、runtime auth、IM sync 的核心规则收敛到可以设计接口的程度，但现有 API 仍停留在 v1 语义：public web form 仍然是 token-only access，draft `delivery-test` 依赖旧 `delivery_method_id`，workspace / EE 也还没有统一的 contact 与 IM control-plane contract。继续直接实现会让 CE / SaaS Flask View、EE protobuf 和前端调用各自发明接口。

## What Changes

- 定义 workspace console API，覆盖 contact 分组、EE 下的 `Platform contact` candidate / add / remove、`External contact` 管理、workspace IM override、Organization 级 IM integration 和 manual sync，并明确 `Platform contact` candidate / add 是 EE-only capability，CE / SaaS 可保留实现但允许运行时报 edition-not-supported。
- 定义 CE / SaaS 的 workflow draft API，保留现有 `form/preview` 与 `form/run` 路由，并把 v1 `delivery-test` 收敛为基于 `DebugChannel` 的 `message-template/test`。
- 定义用户手动确认后批量调用的 Human Input v1 → v2 node-data migration helper API。该 API 只执行 tenant-scoped 批量转换与 blocker 校验；仅当所有节点的新 schema 都生成成功时返回完整结果，只要任一节点生成失败，整个请求就返回错误且不返回部分成功结果。该 API 不持久化 workflow，也不替代前端的批量原子 draft 更新。
- 定义 CE / SaaS 的 public web / service API，覆盖 token-based form read、OTP challenge、token-based upload token 和 submit-time identity verification。
- 定义 EE 管理后台的 protobuf / `google.api.http` contract，限定为 Organization 级 IM integration 与 IM sync control-plane。
- 固定 transport 约束：runtime noun 继续使用 `form`，URL segment 统一使用 `human-input`，Request / Response 统一使用 Pydantic model，优先复用现有 DSL / runtime enum。
- 输出一份根目录汇总 markdown，汇总 Flask View contract、Pydantic DTO、EE proto 章节与必须修正的 DSL 细节。

## Capabilities

### New Capabilities
- `human-input-console-management-api`: workspace console 上的 contact、IM integration、manual sync、draft preview、message template test 与手动 node-data migration helper API contract。
- `human-input-runtime-form-api`: public web 与 service API 上的 form read、OTP challenge、token-based upload token 与 submit-time verification contract。
- `human-input-ee-admin-api`: EE 管理后台的 Organization 级 IM integration 与 sync protobuf / `google.api.http` contract。

### Modified Capabilities
- 无。

## Impact

- `api/controllers/console/app/workflow.py`
- `api/controllers/console/human_input_form.py`
- `api/controllers/console/workspace/`
- `api/controllers/web/human_input_form.py`
- `api/controllers/web/human_input_file_upload.py`
- `api/controllers/service_api/app/human_input_form.py`
- `openspec/changes/add-human-input-v2-migration-ui/design.md`
- `~/workspace/langgenius/dify-enterprise/server/pkg/apis/enterprise/v1/`
- `/Users/qg/.codex/worktrees/5ab7/dify/human-input-v2-api-summary.md`
