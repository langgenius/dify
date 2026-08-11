## Why

当前 IM Control Plane 虽然已有 side-effect-free reconciliation plan 的骨架，但 plan 只表达匹配结果，实际 IM identity / IM binding mutation、ID 分配和 sync result 分类仍由 persistence adapter 在 apply 时重新决策。该边界无法保证所有 Provider Directory entry 都先成为可搜索的 `IMIdentity`，也无法分别记录 IM identity 与 IM binding 的变化。

现在需要把 IM Contact Sync 收敛为一个 Dify-owned application capability：外部 I/O 先生成稳定输入，纯 planner 生成完整 immutable plan，独立 executor 在 Organization 级序列化边界内原子执行 plan 与日志，从而为 CE、SaaS 和 EE 共用同一套 reconciliation 行为。

## What Changes

- 新增 transport-neutral `IMSyncService`、worker orchestration、input loader、plan executor、query ports 和 composition boundary，并在本 change 接入 workspace console Flask handlers；这些 application boundaries 保持可供后续 EE trusted internal API 复用。
- 将 `ReconciliationRunRef` 作为一次 reconciliation 的稳定引用，统一携带 sync run、Integration revision 与 Provider namespace。
- 以一个 composite pure planner 同时产出 IM identity upsert、IM binding mutation、IM identity deletion 与 sync result records；planner 不执行数据库、网络、时钟、随机 ID 或日志 I/O。
- 每个完整 Provider Directory entry 都必须创建或刷新 current `IMIdentity`，即使它没有自动匹配到 Contact；只有 IM binding 的对账结果决定 `Added / Not Matched / Skipped / Removed` bucket。
- 将 Contacts 的 email 匹配准入、CE/SaaS/EE Organization scope、允许本次同步对账的 IM binding IDs 与 Organization-scoped Redis write lock key 的解析留在 application / persistence boundary，不让 pure planner 理解 workspace、deployment、edition、Redis 或 ORM model。
- 将 append-only identity / binding reconciliation change log 与现有 product-facing sync results 分离，并要求 current-state mutation、change-log records、sync results 与 run counters 在同一事务中提交。
- 对同一 Organization 的 reconciliation 与所有可能改变 reconciliation input/current state 的 application writes 使用同一个粗粒度 Redis write lock；同步持锁期间，其他相关写入必须在执行 SQL 前等待。数据库以 revision/precondition checks、conditional writes 与唯一约束兜底，不批量锁定 identity、binding 或 Contact rows。
- 为 pure plan generation 建立 statement 与 branch coverage 均为 95% 的独立 unit-test gate，并为本 change 的完整 production-module scope 分别建立 90% unit-test coverage 与 80% integration-test coverage gate。
- 数据库相关 unit tests 复用项目 SQLite fixtures；PostgreSQL transaction、locking、constraint 与 migration integration tests 统一由 Testcontainers 启动 PostgreSQL。

## Capabilities

### New Capabilities

- `human-input-im-contact-sync`: 定义 Dify-owned manual sync application service、Provider Directory orchestration、scope-aware input loading、plan execution、reconciliation change log、latest-run query、edition-neutral composition boundary 与 workspace Flask API 接入。

### Modified Capabilities

- `contact-directory-governance`: 统一使用 `Organization binding` 表达 Organization 级 Contact–IM identity 默认关系，使 identity 与 binding 在治理规范中保持不同含义。
- `human-input-v2-im-control-plane-core`: 将 reconciliation plan 从匹配提示升级为完整 composite mutation plan，要求 unmatched Directory entry 仍持久化为 IM identity，明确 IM binding 的 ambiguity/replacement/removal 规则，并把 Organization / workspace 概念移出 pure planner。

## Impact

- 主要影响 `api/core/human_input_v2/im_integration/`、`api/services/human_input_v2/`、`api/repositories/human_input_v2/im_integration/`、`api/controllers/console/workspace/human_input.py`、相关 Pydantic contracts、Celery task、Human Input v2 persistence models/migration，以及对应 unit/controller/integration tests。
- 复用 `api/core/human_input_v2/im_provider/contracts.py` 的 complete Directory snapshot，不扩展 Provider adapter 的 shared directory entry 字段，也不把 Provider raw payload 引入 reconciliation contract。
- 本 change 持有 reconciliation-backed workspace Flask handlers 及其 Pydantic mapping；其他 workspace Human Input v2 routes 仍由 `human-input-v2-api-contracts` 持有。Dify EE trusted internal handler、EE Kratos handler 与 Protobuf contract 暂不包含在本 change，由后续 EE transport change 消费同一 application service。
- 需要新增 append-only reconciliation change-log persistence，并保持现有 latest-run `Added / Not Matched / Failed / Removed / Skipped` transport contract 的产品语义。
- 不新增外部依赖；backend 命令继续通过 `uv run --project api` 执行，并复用现有 Testcontainers dependency 与 CI integration-test job 启动 PostgreSQL。
