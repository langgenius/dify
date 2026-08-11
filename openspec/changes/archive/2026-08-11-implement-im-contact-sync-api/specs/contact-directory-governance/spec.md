## MODIFIED Requirements

### Requirement: IM Integration、Organization binding 与 workspace override 归属
系统 MUST 将 IM Integration 凭据归属到 Organization。系统 MUST 只允许一个 Organization 级 IM channel 生效。负责管理该 Organization 级 IM channel 的管理员身份 MUST 随部署形态确定：EE 中 MUST 由企业管理员在 EE 后台管理；CE / SaaS 中 MUST 由 workspace owner 或 workspace admin 在 workspace 内管理。Organization binding MUST 表示 Organization 级 Contact 与 IM identity 的默认 IM binding。workspace override MUST 只覆盖当前 workspace 内 Contact 使用的 IM binding 或通知行为，MUST NOT 覆盖 IM Integration 凭据。

#### Scenario: EE 由企业管理员管理 Organization 级 IM channel
- **WHEN** the deployment shape is EE
- **THEN** 系统 MUST 要求企业管理员在 EE 后台管理唯一的 Organization-level IM channel

#### Scenario: CE / SaaS 由 workspace owner 或 admin 管理 Organization 级 IM channel
- **WHEN** the deployment shape is CE or SaaS
- **THEN** 系统 MUST 要求 workspace owner or workspace admin 在当前 workspace 内管理唯一的 Organization-level IM channel

#### Scenario: Workspace override 优先于 Organization binding
- **WHEN** a Contact has both a workspace override and an Organization binding
- **THEN** 系统 MUST 在当前 workspace 运行时优先使用 workspace override

#### Scenario: Reset override 恢复 Organization binding
- **WHEN** a workspace admin removes or resets a Contact's workspace override
- **THEN** 系统 MUST 在该 workspace 后续运行时恢复使用 Organization binding

#### Scenario: IM sync 未命中时进入 unmatched list
- **WHEN** IM sync cannot match a member by IM platform user ID and also cannot match that member to any `organization contact` by email
- **THEN** 系统 MUST 将其放入 unmatched list，等待管理员手动处理，并 MUST NOT 自动创建 `External contact`
