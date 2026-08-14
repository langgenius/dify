## Context

当前仓库已经存在一批 Human Input v2 contract 资产：

- `api/controllers/common/human_input_v2_contracts.py` 中的 Pydantic DTO
- console / web / service API 的 Human Input v2 route scaffold
- `api/models/human_input_v2.py` 中的 IM integration、binding、form、grant、endpoint、submission、audit 和 upload persistence models
- OTP proof-session migration 与对应 repository / controller / contract tests

这些资产可以继续作为规范与持久化边界保留，但它们并不等于 application wiring 已完成。过去把它们和“谁来实现 runtime / sync / EE upstream / draft debug”绑在一个 change 里，导致旧 change 同时承担 normative spec、implementation design 和 roadmap owner 三种职责。

本次收口后的目标是：

- 让这个 change 只拥有 contract 与 persistence 形状
- 把所有仍待实现的业务 wiring 转交给 Linear 和 focused OpenSpec
- 在归档时把最终 API contract delta 正常同步到 living specs

## Goals

- 保留并收口 Human Input v2 的 API contract delta。
- 保留已经落地的 DTO、route scaffold、DB models / migrations 和 contract-test 证据。
- 把四条关键 PRD correction 合入最终 contract：
  - internal / external same-email coexistence
  - Dynamic Email always stays EmailAddress-backed
  - `all_workspace_contacts`
  - scope-aware IM identity reuse
- 去掉这个 change 上不该再持有的 implementation ownership 决策。

## Non-Goals

- 不把 controller 501 stub 接成业务实现。
- 不在本 change 中新增 application service、composition root、worker orchestration 或 EE typed client。
- 不把未完成 implementation work 假装成已完成。
- 不替代对应 Linear issue 或 focused OpenSpec 的实现计划。

## Decisions

### 1. This change is the normative owner of contract shape, not implementation wiring

本 change 保留以下 owner：

- route / namespace / auth surface 的 contract
- request / response DTO shape
- error-code / pagination / CAS / version-isolation semantics
- persistence model and migration shape
- contract-level tests and fixtures

本 change 不再持有以下 owner：

- application service 与 repository orchestration
- controller-to-service wiring
- workflow runtime composition
- Dify internal HTTP upstream implementation
- EE Kratos façade implementation
- draft preview/run 与 `message-template/test` 的后端业务接线

### 2. Console API keeps the final corrected contract, even if the implementation moves elsewhere

`human-input-console-management-api` 仍然是最终 living spec 的来源，但其实施责任拆分如下：

- Contact / External Contact management implementation: `WTA-1267`
- latest-only IM sync / override behavior: `WTA-1270`
- IM management API unification: `WTA-1875`
- Dify internal HTTP upstream reused by EE: `WTA-1968`
- draft preview/run and `message-template/test`: `WTA-1969`

该 console contract 在归档前合入四个修正规则：

- `External contact` 可与内部 Contact 同邮箱
- migration helper 输出 `all_workspace_contacts`
- 不再描述 `Dynamic Email -> Contact` 升级
- workspace override / Organization binding 允许 scope-aware IM identity reuse

### 3. Runtime form surfaces remain version-isolated and auth-isolated

contract 保留以下边界：

- public Email proof surface: `/api/form/human-input/...`
- authenticated Contact surface: `/console/api/form/human-input/...`
- trusted service surface: `/v1/form/human-input/...`
- legacy v1 underscore routes stay unchanged

同时收入口径为：

- Dynamic Email grant 始终走 Email-proof 语义
- public read 不授予 submit authority
- v1 / v2 token、DTO、submit logic 继续隔离

runtime 的真正 wiring、submit handler composition、resume 和 workflow orchestration 由 `WTA-1908`–`WTA-1913` 与 `implement-human-input-v1-v2-runtime-composition` 持有。

### 4. EE admin contract stays narrow; its upstream owner is explicit and externalized

`human-input-ee-admin-api` 继续保留为窄 façade contract，只覆盖：

- Organization IM integration
- manual sync latest-only reads
- Organization Contact binding façade

它不再声称“本 change 是 trusted internal HTTP 的唯一 owner”。该 upstream 现在显式转交为：

- `WTA-1968`: Dify internal HTTP + `OrganizationContactProjectionService`
- `implement-ee-human-input-admin-api`: EE façade delivery plan

### 5. Persistence assets remain accepted-and-landed even when runtime implementation is incomplete

以下资产作为 accepted contracts / persistence shape 保留：

- `HumanInputIMIntegration`, `HumanInputIMBinding`
- `HumanInputV2Form`, `HumanInputV2FormApproverGrant`, `HumanInputV2FormDeliveryEndpoint`
- `HumanInputV2FormOTPChallenge`, `HumanInputV2FormSubmission`, `HumanInputV2FormAuditEvent`
- related immutable Pydantic payload models and hashed-proof migration

这表示：

- 数据模型和 schema shape 已被接受
- 归档这个 change 不要求删除这些资产
- 但并不意味着所有基于这些资产的 runtime wiring 都已经完成

## Successor Ownership

| Scope | Successor |
| --- | --- |
| Contact / External Contact management implementation | `WTA-1267` |
| Dify internal HTTP and Organization Contact projection | `WTA-1968` |
| draft preview/run and `message-template/test` implementation | `WTA-1969` |
| IM card handled-status update | `WTA-1970` |
| migration compatibility UI round-trip | `WTA-1971` |
| runtime dispatch / form creation / submit / resume / E2E | `WTA-1908`–`WTA-1913`, `implement-human-input-v1-v2-runtime-composition` |
| IM sync implementation and latest-only UI delivery | `WTA-1270`, `integrate-im-contact-sync-end-to-end` |
| IM management API unification | `WTA-1875` |
| backend node-data migration helper implementation | archived `WTA-1288` |

## Archive Outcome

归档该 change 表示：

- final API contracts have been synced to living specs
- old mixed implementation responsibilities have been split out
- landed DTO / model / migration assets remain in place

归档该 change 不表示：

- runtime wiring 已完成
- EE upstream 已完成
- draft debug backend 已完成
- IM sync / override / unified channels delivery 已完成
