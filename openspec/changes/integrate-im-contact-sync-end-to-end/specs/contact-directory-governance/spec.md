## MODIFIED Requirements

### Requirement: IM identity 必须基于手动同步结果选择
系统 MUST 通过 IM sync 结果提供 IM identity 选择源，MUST NOT 在一期要求管理员手工输入自由文本 IM user ID。IM sync MUST 由 Organization 管理员手动触发：首次在 IM 配置完成后手动同步，后续刷新也由管理员 / owner 手动发起。创建并 dispatch 新 sync run 前，application boundary MUST bounded-ensure 当前 Organization Contact projection，使本次 reconciliation 能在正确 scope 中读取 active Account/member 对应的 Contact；该 ensure MUST 复用 Contact lifecycle owner，MUST NOT 在 IM planner 或 repository 中复制 Contact 创建规则。

#### Scenario: IM 配置完成后手动同步
- **WHEN** an Organization-level IM channel has been configured successfully
- **THEN** 系统 MUST 要求 Organization 管理员手动发起 IM sync，之后才允许从同步结果中选择 IM identity

#### Scenario: 手动同步前确保当前 Contact projection
- **WHEN** an authorized administrator requests a new manual IM sync
- **THEN** application boundary MUST bounded-ensure all currently eligible Account/member facts required by that Organization scope before dispatch
- **AND** reconciliation MUST read the resulting scope-correct Contact snapshot for Email matching

#### Scenario: Contact projection 暂时不可用
- **WHEN** bounded Contact projection cannot establish a current, owner-scoped snapshot within its limit
- **THEN** system MUST return a stable retryable failure before provider directory I/O or new-run dispatch
- **AND** it MUST NOT continue against a silently incomplete Contact set

#### Scenario: 已存在 active run
- **WHEN** create-or-get semantics resolve an already queued or running run
- **THEN** system MUST return that persisted run without creating a duplicate
- **AND** any recovery dispatch MUST carry the same run ID and MUST NOT create a second logical run

#### Scenario: 从同步 IM contact 中选择 IM identity
- **WHEN** an admin configures IM identity for a contact
- **THEN** 系统 MUST 提供基于同步 IM contacts 的搜索与选择能力，且该搜索 MUST 支持按 IM user ID 查询，并 MUST NOT 依赖手工输入自由文本 IM user ID
