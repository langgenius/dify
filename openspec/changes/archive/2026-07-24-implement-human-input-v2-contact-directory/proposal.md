## Why

Human Input v2 需要一个稳定的 Contact Directory 边界来统一 canonical identity、workspace-relative 可见性和 Contact lifecycle。若这些规则继续散落在 ORM、controller 和调用方中，后续 recipient resolution、IM binding 与 submission authorization 会重复理解 owner、membership 和 Contact type。

## What Changes

- 建立 transport/ORM independent 的 Contact entity、owner reference、normalized Email 和 workspace resolution policy。
- 将 immutable identity source 与 `WORKSPACE / PLATFORM / EXTERNAL / ABSENT` 查询结果分离。
- 定义 request-scoped directory snapshot，以及面向 lifecycle mutation 和 snapshot load 的事务型 persistence ports。
- 对 Contact 与 Platform allow-list persistence records 提供显式 mapping、SQLAlchemy adapter、schema migration 和 PostgreSQL concurrency coverage。
- 保留 `core.human_input_v2.entities` 的兼容导出，但不把无行为的共享抽象扩展成独立 change。

## Capabilities

### New Capabilities

- `human-input-v2-contact-directory-core`: 定义 Human Input v2 Contact identity、workspace resolution、lifecycle、directory snapshot 和事务型 persistence 行为。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/shared/`
- `api/core/human_input_v2/contact_directory/`
- `api/models/human_input_v2.py`
- `api/repositories/human_input_v2/contact_directory/`
- `api/migrations/versions/`
- `api/tests/unit_tests/core/human_input_v2/`
- `api/tests/unit_tests/repositories/human_input_v2/`
- 后续 IM control plane、recipient resolution 与 approval runtime changes
