## Why

这个 change 最初用于冻结 Human Input v2 的 HTTP / DTO / persistence contract，但后续混入了 application service、controller wiring、runtime composition、EE façade 总体验收和 implementation roadmap。继续把它当成“大一统实现 change”会让 living specs、Linear owner 和 focused OpenSpec 的职责重新缠在一起。

本次收口把它恢复成 contract-only change：只保留已经落地且仍然有效的 API contract、Pydantic DTO、route scaffold、DB models / migrations 和 contract-test 证据；所有未完成实现责任转交给明确的 Linear issue 和 focused OpenSpec。

## What Changes

- 保留三组规范性 contract：
  - workspace console management API
  - runtime form API
  - EE admin façade API
- 保留并归档已经存在的 contract assets：Pydantic request / response models、controller route scaffold、workspace/runtime namespace split、Human Input v2 persistence models、OTP proof-session migration 和相关 contract tests。
- 将已经确认的 PRD corrections 合入最终 API contract delta：
  - `External contact` 允许与内部 Contact 同邮箱共存
  - `Dynamic Email` 始终保持 task-scoped one-time email 语义
  - migration helper 使用 `all_workspace_contacts`，不再把 `whole_workspace` 展开为有损静态快照
  - IM binding / override contract 采用 scope-aware identity reuse 语义
- 删除 application service、controller wiring、runtime composition、EE internal HTTP upstream、draft debug implementation owner 等实施范围；这些责任改由明确的 Linear / focused change 持有。

## Capabilities

### New Capabilities
- `human-input-console-management-api`: workspace console 上的 Contact 管理、IM integration/latest-only sync、draft preview/run、`message-template/test` 与 node-data migration helper contract。
- `human-input-runtime-form-api`: public web、authenticated Contact 和 service API 上的 form read / OTP / upload / submit contract。
- `human-input-ee-admin-api`: EE 管理后台的 Organization 级 IM integration / sync 与 Organization Contact IM binding façade contract。

### Modified Capabilities
- 无。

## Impact

- Landed contract assets retained in repo:
  - `api/controllers/common/human_input_v2_contracts.py`
  - `api/controllers/common/human_input_v2_migration.py`
  - `api/controllers/console/workspace/human_input.py`
  - `api/controllers/console/app/workflow_human_input_v2.py`
  - `api/controllers/console/human_input_form.py`
  - `api/controllers/web/human_input_form.py`
  - `api/controllers/web/human_input_form_access_request.py`
  - `api/controllers/web/human_input_file_upload.py`
  - `api/controllers/service_api/app/human_input_form.py`
  - `api/models/human_input_v2.py`
  - `api/migrations/versions/2026_07_25_1300-9c2e5f7a1b3d_add_human_input_v2_otp_proof_session.py`
- Successor implementation ownership:
  - Contact / External Contact management: `WTA-1267`
  - IM sync and workspace override delivery: `WTA-1270`, `integrate-im-contact-sync-end-to-end`
  - IM management API unification: `WTA-1875`
  - Workflow runtime composition / submit / resume / E2E: `WTA-1908`–`WTA-1913`, `implement-human-input-v2-runtime-composition`
  - Dify internal HTTP + Organization Contact projection upstream: `WTA-1968`, `implement-ee-human-input-admin-api`
  - draft `preview/run` + `message-template/test` backend wiring: `WTA-1969`
  - migration compatibility UI round-trip: `WTA-1971`
