## Why

Submission authorization 需要组合 current Contact、Account、workspace availability、Email 与 IM binding facts，并在一个事务中提交唯一 submission、audit 和 form transition。这是一项跨 snapshot 的决策与原子用例，不应污染 `HumanInputForm` 的局部 lifecycle，也不应由 controller 或通用 CRUD repository 拼装。

## What Changes

- 将 approver grant、delivery endpoint、verified proof 与 submission actor 保持为不同概念，并拒绝 raw credential 进入 authorization boundary。
- 建立纯 `SubmissionAuthorizer` 和 coherent `AuthorizationContext` snapshot semantics。
- 定义并实现 atomic `commit_authorized_submission_once`，用 Form row lock、unique submission constraint 和冲突翻译保证 first-success。
- 建立 submit application handler，使 workflow resume 只在 commit 后通过 idempotent port 调度；enqueue failure 不回滚 submission。
- 对 submission 和 authorization audit records 提供显式 mapping、SQLAlchemy adapter、schema migration、application-handler tests 与 PostgreSQL concurrency coverage。

## Capabilities

### New Capabilities

- `human-input-v2-submission-runtime`: 定义 current-state submission authorization、first-success transaction 和 post-commit resume orchestration。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/approval/submission_authorization.py`
- `api/services/human_input_v2/`
- `api/models/human_input_v2.py`
- `api/repositories/human_input_v2/submission/`
- `api/migrations/versions/`
- `api/tests/unit_tests/core/human_input_v2/approval/`
- `api/tests/unit_tests/repositories/human_input_v2/`
- 依赖 Contact Directory、IM Control Plane、Form Core 与 OTP Proof Session changes
- 后续 API controller/provider adapter implementation changes
