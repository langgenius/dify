## Why

IM Integration configuration、directory synchronization 和 effective binding 共享同一组 revision、provider identity 与 replacement 语义，应由一个独立 control-plane 边界隐藏。把它们拆成配置、同步和 binding 三个执行阶段会让 CAS token、stale reconciliation 和 identity invalidation 决策泄漏到多个模块。

## What Changes

- 建立 `IMIntegration` CAS aggregate，以 integration ID 和 configuration version 组成完整 revision token。
- 建立独立 `IMSyncRun` aggregate、纯 `SyncReconciler`、immutable result facts 和 revision-guarded reconciliation plan。
- 封装 provider-user-ID-first matching、normalized-email fallback 和 effective binding priority。
- 定义面向 CAS write、single-active-run creation、idempotent retry、binding snapshot 和 reconciliation apply 的事务型 persistence ports。
- 对 IM Integration、identity、binding、sync run/result records 提供显式 mapping、SQLAlchemy adapter、schema migration 和 PostgreSQL concurrency coverage。

## Capabilities

### New Capabilities

- `human-input-v2-im-control-plane-core`: 定义 IM Integration revision、sync reconciliation、effective binding 和相关事务并发语义。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/im_integration/`
- `api/models/human_input_v2.py`
- `api/repositories/human_input_v2/im_integration/`
- `api/migrations/versions/`
- `api/tests/unit_tests/core/human_input_v2/`
- `api/tests/unit_tests/repositories/human_input_v2/`
- 依赖 `implement-human-input-v2-contact-directory`
- 后续 recipient resolution 与 approval runtime changes
