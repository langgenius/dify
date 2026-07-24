## Why

Human Input form、approver grant 和 delivery endpoint 是创建时冻结、提交时转换的同一业务状态边界，应由一个 rich aggregate 隐藏 lifecycle 与 snapshot 规则。把这些概念留在 ORM record 或 recipient resolver 中，会让 form active-state、grant membership 和 endpoint semantics 在后续 submission、delivery 与 query 路径重复实现。

## What Changes

- 建立 rich `HumanInputForm` aggregate，直接拥有 active-state、selected-action validation 和 first-success transition decision。
- 建立 immutable approver grant、subject snapshot、delivery endpoint、delivery attempt 和 frozen form definition concepts。
- 明确 grant 只表示创建时的候选审批资格，endpoint 只表示通知/交互落点；二者均不自动成为当前 submission authority。
- 定义面向 form creation/load 和 append-oriented delivery facts 的事务型 persistence ports。
- 对 form、grant、endpoint、delivery attempt、upload 和 Email provider records 提供显式 mapping、SQLAlchemy adapter、schema migration 和 query-count coverage。

## Capabilities

### New Capabilities

- `human-input-v2-form-core`: 定义 Human Input v2 form aggregate、grant/endpoint snapshots、form lifecycle 和相关 persistence 行为。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/approval/form.py`
- `api/core/human_input_v2/approval/grants.py`
- `api/core/human_input_v2/approval/delivery.py`
- `api/models/human_input_v2.py`
- `api/repositories/human_input_v2/form/`
- `api/migrations/versions/`
- `api/tests/unit_tests/core/human_input_v2/approval/`
- `api/tests/unit_tests/repositories/human_input_v2/`
- 依赖 `implement-human-input-v2-recipient-resolution`
- 后续 OTP proof-session 与 submission runtime changes
