## Why

Recipient resolution 同时处理输入校验、Contact upgrade、subject canonicalization、matched-source aggregation 和 endpoint planning，是一个应向调用方隐藏复杂度的深模块。若调用方分别执行这些步骤，同一 recipient decision 会在 workflow、API 和 delivery 路径中产生不一致。

## What Changes

- 定义 immutable recipient specifications，并从 workflow node v2 configuration 显式转换。
- 建立唯一的 `RecipientResolver` 入口，消费 Contact directory snapshot 与 effective delivery capability snapshot。
- 生成 deterministic `ResolvedApprovalPlan`，包含 canonical approvers、matched sources、subject snapshots、endpoint plans 和 rejected-recipient facts。
- 定义 debug replacement、current initiator、unmatched Email 和 no-valid-recipients 的稳定语义。
- 添加纯 domain tests；本 change 不引入数据库表、controller 或 provider adapter。

## Capabilities

### New Capabilities

- `human-input-v2-recipient-resolution-core`: 定义 Human Input v2 recipient specification、canonical approval plan 和单一 resolution 行为。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/approval/recipient_resolution.py`
- `api/core/human_input_v2/approval/recipient_specifications.py`
- `api/tests/unit_tests/core/human_input_v2/approval/`
- 依赖 `implement-human-input-v2-contact-directory`
- 依赖 `implement-human-input-v2-im-control-plane`
- 后续 approval runtime change
