## Why

当前 `HumanInputContact` 同时保存 Contact identity、Account profile 副本、External Contact profile 与 workspace 可见性来源，现有实现又通过 `ContactDirectorySnapshot` 和 `ContactDirectoryPolicy` 把这些表级事实暴露给 recipient、authorization 与 IM 调用方。这造成重复 profile 写入、全量 snapshot 查询、调用方重复解释可见性，以及跨模块直接访问 Contact ORM。

新的 schema 已将 Contact identity 与 profile 分开；当前实现应直接围绕该 schema 重写，并删除未发布的 `ContactDirectory` 抽象。

## What Changes

- **BREAKING（内部）**：删除 `api/core/human_input_v2/contact_directory`、`api/repositories/human_input_v2/contact_directory` 以及 `ContactDirectoryPolicy`、`ContactDirectorySnapshot`、`ContactResolution`、`ContactDirectoryRepository` 等内部符号。
- 删除 `contact-directory-governance` 的全部 legacy requirements；将仍有效的 Contact、tenant、IM、Console 与 UI behavior 归入各自已有 capability 或新的 Contact Repository capability。
- 将未发布的 `HumanInputContact` ORM 改为 `HumanInputContactIdentity` 与 `HumanInputExternalContactProfile`，保留所有现有 UUID `contact_id` 引用。
- 以 `ContactRepository` 作为 current Contact 的唯一查询与 lifecycle write port；以 `ContactIMBindingRepository` 作为 Contact-facing IM binding query port。
- current Contact 只返回 `WORKSPACE`、`PLATFORM` 或 `EXTERNAL`。不可用 Contact 由查询缺失、`None` 或 `available(...)=False` 表达，不再定义 `ABSENT` 状态。
- `ContactRepository` 直接组合 `HumanInputContactIdentity`、`Account`、`TenantAccountJoin`、`HumanInputPlatformContactWorkspaceEntry` 与 `HumanInputExternalContactProfile`，调用方不得接触这些表的组合规则。
- Account-backed Contact ID 全局稳定；membership、Platform entry、Account status 或 Account profile 变化不得替换或修改 Contact identity。
- External Contact profile 继续由 workspace 管理；同 workspace External Email 唯一，但 Account-backed Contact 与 External Contact 可以共享 normalized Email。
- Repository implementation 接收调用方提供的同一个 SQLAlchemy `Session`。`Session` 直接承担 transaction boundary；不新增 Unit of Work abstraction，Repository 不自行创建 Session 或 commit。
- recipient、authorization、submission、IM matching、Console Contact API 与 lifecycle code 改为依赖上述两个 Repository，而不是 snapshot、policy 或 Contact ORM。

## Capabilities

### New Capabilities

- `human-input-v2-contact-repository`: 定义 Contact identity/profile schema、`ContactRepository`、`ContactIMBindingRepository`、current Contact 查询语义与 Session transaction contract。

### Modified Capabilities

- `contact-directory-governance`: 移除全部 legacy requirements；不再保留该 capability 的 active semantics。
- `human-input-v2-contact-directory-core`: 移除旧 domain、snapshot、policy 与 aggregate repository requirements；其替代 contract 由 `human-input-v2-contact-repository` 提供。
- `human-input-console-management-api`: 将旧 Contact Directory/`ABSENT` transport 表述改为 current Contact API 的缺失/`404` 语义，并明确 EE implementation 继续拥有跨 tenant Platform candidate search。
- `human-input-v2-recipient-resolution-core`: 让 application layer 通过两个 Repository 预加载 current Contact 与 binding values，pure resolver 不再接收旧 snapshot/policy input。

## Impact

- ORM 与 migration：`api/models/human_input_v2.py` 及未发布的 Contact schema revision。
- Domain 与 repositories：删除旧 Contact package，新增 Contact values、Repository protocols 与 SQLAlchemy adapters。
- Current Contact consumers：Console list/detail/options、recipient resolution、form grant、OTP、submission authorization、IM matching、binding read 与 lifecycle hooks。
- Test suites：schema constraints、Repository query parity、concurrency、tenant isolation、consumer regression 与 import-boundary coverage。
- External contracts：Console、workflow DSL、grant、OTP、IM、sync history 与 reconciliation 的 `contact_id` shape 保持不变。
