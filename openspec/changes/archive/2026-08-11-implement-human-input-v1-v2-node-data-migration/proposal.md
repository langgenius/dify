## Why

Human Input v2 已经具备前端批量迁移边界、后端 Pydantic DTO 和 Workspace Console route scaffold，但权威转换仍未落地，后端 endpoint 继续返回 `501`，前端只能依赖一套已经偏离最新 PRD 的临时 mock converter。WTA-1288 拆分后需要一个独立 change，把旧 Email recipient 的确定性、无副作用 v1 → v2 node-data 转换落地，同时避免重新引入 Contact 自动升级或 `whole_workspace` 静态展开。

## What Changes

- 实现 `POST /console/api/workspaces/current/human-input/node-data-migration` 的 side-effect-free batch conversion application service 与薄 controller wiring。
- 将所有 legacy Email recipient 迁移为有序、规范化的 `onetime_email`；legacy member reference 仅通过只读 member/account lookup 取得当前有效 Email，不查询 Contact，也不创建或更新任何 Contact。
- 为迁移输出加入 migration-only `all_workspace_contacts` recipient 表示，将 `whole_workspace: true` 无损转换为一个显式 marker，而不是当前成员静态列表。
- 保留迁移产生的兼容性 overlap；对普通 canonical duplicate 继续按首次出现顺序确定性去重。
- 保留 enabled WebApp、Email message template、Email debug mode 和共享 Human Input node fields；对 disabled-but-configured、unsupported delivery、invalid Email、unresolved member、conflicting template 和 missing recipient 返回 node-scoped structured blockers。
- 保证整批 all-or-error、输入顺序稳定、重复调用结果确定、无持久化副作用；不修改 workflow DSL、Draft、Published workflow、Contact 或 migration history。
- 将本 change 设为后端 node-data conversion 的单一实现 owner，取代 `human-input-v2-api-contracts` 中尚未实现且已过时的 migration tasks；Contact 初始化、runtime task snapshot、Draft 原子替换/回滚、前端 real-client 接入、导入导出和 DSL ID-Email 转换保持在其他 change 中。

## Capabilities

### New Capabilities

- `human-input-v1-v2-node-data-migration`: 定义 legacy Human Input node batch validation、Email/member recipient 映射、`all_workspace_contacts` 兼容表示、blocker taxonomy、确定性 all-or-error 转换及无副作用 Workspace Console helper contract。

### Modified Capabilities

<!-- No living capability requirements are modified. Migration requirements currently exist only in active change-local specs. -->

## Impact

- Backend workflow models under `api/core/workflow/nodes/human_input*` for exact v1 input and v2 migration-output representation.
- A new transport-neutral migration service under `api/services/human_input_v2/` with a narrow read-only member Email lookup port.
- Existing migration DTOs in `api/controllers/common/human_input_v2_contracts.py` and the `NodeDataMigrationAPI` stub in `api/controllers/console/workspace/human_input.py`.
- Unit coverage for node conversion, deterministic batching, blocker aggregation, controller mapping, zero writes, and v1/v2 regression boundaries.
- Coordination with `add-human-input-v2-migration-ui`, `align-human-input-specs-with-prd-corrections`, and the migration section of `human-input-v2-api-contracts`; no database migration or new external dependency.
