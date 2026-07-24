## Why

Human Input v2 已经具备审计后的业务 spec、API contract stub 和数据库模型，但核心业务不变量仍主要分散在 OpenSpec 文本、ORM 约束和 controller DTO 中。继续从 API stub 开始实现会让 transport 与 persistence 结构反向定义业务模型，因此需要先建立清晰、可测试的领域边界和事务契约。

## What Changes

- 建立 Contact Directory、IM Control Plane、Approval Runtime 三个明确的领域边界，并固定它们之间的依赖方向。
- 将 `ContactIdentitySource` 与 workspace-relative `ContactType` 分离，显式建模 Contact lifecycle、workspace resolution 和当前可用性规则。
- 将 `RecipientSpecification`、canonical approver、delivery endpoint、authorization proof 和 submission actor 建模为不同概念，并提供单一 recipient resolution 入口。
- 建立 Human Input form 聚合及其 `first success wins`、当前身份重校验、snapshot 只读回溯等不变量。
- 建立 IM integration revision、sync snapshot、effective binding 和 stale-write rejection 的领域契约。
- 定义按聚合与事务用例组织的 persistence ports、SQLAlchemy mapping 边界和稳定 domain error taxonomy，避免按表暴露 repository。
- 为核心领域规则、并发语义和 persistence mapping 添加分层测试；本 change 不实现 controller、外部 IM/Email provider 或 EE protobuf adapter。

## Capabilities

### New Capabilities

- `human-input-v2-domain-core`: 定义 Human Input v2 的领域边界、聚合不变量、recipient resolution、submission authorization、事务契约和 persistence port 行为。

### Modified Capabilities

- 无。

## Impact

- `api/core/human_input_v2/`
- `api/models/human_input_v2.py`
- `api/repositories/human_input_v2/`
- `api/migrations/versions/`
- `api/tests/unit_tests/core/human_input_v2/`
- `api/tests/unit_tests/repositories/human_input_v2/`
- 后续 `human-input-v2-api-contracts`、Contact、Email approval、IM control-plane 和 EE adapter implementation changes
