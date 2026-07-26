## Why

当前仓库已经具备 IM control plane、Contact Directory 和管理端 DTO / mock UI 的基本骨架，但真正的后端管理 API 仍是 stub，导致 IM 联系人同步无法落地，也无法把同步结果稳定接入现有 Contact / IM binding 语义。现在需要把同步逻辑收敛到统一的管理 API 与统一的 provider adapter 边界后面，避免为 Feishu、Lark 等厂商分别发明一套控制面接口。

## What Changes

- 落地一组统一的 workspace-scoped Human Input IM 管理 API，用于读取 / 更新 IM integration、测试连接、触发手动 sync、读取最新 sync run 和分页结果。
- 增加一个 application service 层，统一编排 provider directory 拉取、`ProviderDirectoryEntry` 归一化、`SyncReconciler` 计划生成和 repository apply，而不是让 controller 或厂商 adapter 直接操作领域模型。
- 落地把同步结果接到现有 Contact 代码的管理入口，包括搜索 synced IM identities、为 Contact 创建 organization binding、删除 binding，以及为 EE contact 设置 / 清除 workspace override。
- 为 Feishu / Lark 引入同一类 provider adapter 契约，优先通过厂商 SDK 拉取目录数据；厂商差异只允许存在于 adapter 内部，统一 API 与 application service 不感知厂商特例。
- 补齐 controller、service、repository 和集成测试，使 manual sync、latest run read、unmatched 保留、binding 写入、stale revision 和并发触发等高风险路径具备可回归覆盖。

## Capabilities

### New Capabilities
- `human-input-v2-im-sync-management-api`: 定义统一的 IM integration / sync 管理 API、手动同步入口、latest run 摘要与结果分页，以及 provider adapter 到统一 directory entry 的应用层编排边界。
- `human-input-v2-contact-im-binding-management-api`: 定义如何把同步得到的 IM identities 接入现有 Contact / binding / workspace override 入口，而不引入厂商专属 binding API。

### Modified Capabilities
- None.

## Impact

- Affected code: `api/controllers/console/workspace/human_input.py`, `api/controllers/common/human_input_v2_contracts.py`, `api/services/human_input_v2/*`, `api/core/human_input_v2/im_integration/*`, `api/repositories/human_input_v2/im_integration/*`, `api/repositories/human_input_v2/contact_directory/*`.
- Affected tests: `api/tests/unit_tests/core/human_input_v2/*`, `api/tests/unit_tests/repositories/human_input_v2/*`, `api/tests/unit_tests/controllers/console/*`, `api/tests/integration_tests/repositories/human_input_v2/*`.
- Dependencies: 需要为 Feishu / Lark provider adapter 评估并接入合适的厂商 SDK，避免直接手写大量 provider HTTP glue。
- Operations: 本 change 继续沿用手动 sync；`im.env` 中现有本地密钥仅作为开发 / 测试配置输入，不改变运行时配置边界。
