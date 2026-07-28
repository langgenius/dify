## ADDED Requirements

### Requirement: Contact IM binding operations MUST use one provider-neutral application service

`ContactIMBindingService` MUST provide transport-neutral operations for synchronized identity search、organization binding create/delete 和 workspace override set/reset。provider-specific request types、SDK model 和 transport DTO MUST NOT enter this application boundary；HTTP method、path、Pydantic model、authentication 和 response/error mapping MUST remain owned by `human-input-v2-api-contracts`。

#### Scenario: Search synced identities by provider user ID
- **WHEN** an application consumer searches with a provider user ID, display name, or email keyword
- **THEN** the service MUST query the synchronized identity set and return provider-neutral identity candidates

#### Scenario: Bind one identity to a contact
- **WHEN** an application consumer requests a binding between one eligible contact and one synchronized identity
- **THEN** the service MUST perform the write through the existing organization binding transaction boundary

#### Scenario: Delete one binding from a contact
- **WHEN** an application consumer requests deletion of an existing contact binding
- **THEN** the service MUST remove only the selected binding through the same transaction boundary

### Requirement: Contact IM bindings MUST attach only to current non-external contacts

系统 MUST 只允许把同步得到的 IM identity 绑定到当前 workspace 中可解析的 `WORKSPACE` 或 `PLATFORM` contact。`External contact`、`ABSENT` contact、hard-deleted contact 或其他 unavailable subject MUST 被拒绝，系统 MUST NOT 通过绑定写路径隐式创建或恢复 Contact。

#### Scenario: Bind to a workspace or platform contact
- **WHEN** the target contact currently resolves as `WORKSPACE` or `PLATFORM`
- **THEN** the system MUST allow the IM binding write if the selected identity is valid for the current integration

#### Scenario: Bind to an external contact
- **WHEN** the target contact resolves as `EXTERNAL`
- **THEN** the system MUST reject the command because external contacts remain email-only in the current business scope

#### Scenario: Bind to an absent or deleted contact
- **WHEN** the target contact resolves as `ABSENT` or has been hard-deleted
- **THEN** the system MUST reject the command and MUST NOT recreate the contact or its availability

### Requirement: Unmatched sync results MUST remain read-only contact facts

manual sync 未命中的 provider entry MUST 只作为后续人工处理的 sync result 保留。系统 MUST NOT 因为 unmatched 条目而自动创建 `External contact`、自动写入 IM binding，或把 provider identity 直接提升成 Contact。

#### Scenario: Viewing an unmatched provider entry
- **WHEN** a latest sync result item is classified as `not_matched`
- **THEN** the application read model MUST expose it as a read-only sync fact without creating a contact or binding side effect

#### Scenario: Attempting to bind through unmatched status alone
- **WHEN** an operator only knows an unmatched sync result item but no current eligible contact exists
- **THEN** the service MUST require an existing eligible contact and MUST NOT auto-admit a new contact

### Requirement: Workspace override MUST remain distinct from organization binding

workspace IM override 和 organization binding MUST 是两条不同的写路径。设置 workspace override MUST NOT 改写 organization binding；清除 workspace override MUST 回退到现有 global binding 解析结果，而不是复制或重建 organization binding。

#### Scenario: Set one workspace override in EE
- **WHEN** the edition policy permits an EE workspace override and an eligible identity is selected
- **THEN** the service MUST store a workspace-scoped override without modifying the organization-scoped binding

#### Scenario: Reset one workspace override
- **WHEN** an application consumer requests override reset
- **THEN** the service MUST remove only the workspace override and MUST expose the global binding again through normal resolution

#### Scenario: Override is unsupported in CE or SaaS
- **WHEN** the deployment policy does not support workspace-local overrides
- **THEN** the service MUST reject the command with a typed edition-not-supported error instead of emulating EE-only behavior

### Requirement: Sync-written bindings MUST flow back into the existing effective-binding resolver

任何通过 identity binding 或 workspace override 写入的 current state，都 MUST 继续由现有 effective-binding resolution 规则消费，即 `workspace override > organization binding > Email fallback`。provider adapter、application service 和 transport consumer MUST NOT 额外实现一套平行解析逻辑。

#### Scenario: Workspace override wins over organization binding
- **WHEN** a contact has both a valid workspace override and a valid organization binding
- **THEN** the current effective-binding resolver MUST return the workspace override

#### Scenario: Global binding remains after override reset
- **WHEN** the workspace override is deleted while the organization binding remains valid
- **THEN** the current effective-binding resolver MUST fall back to the organization binding without copying it into workspace scope

#### Scenario: Binding becomes invalid after integration replacement
- **WHEN** the current integration is replaced and existing bindings are invalidated
- **THEN** the effective-binding resolver MUST stop exposing the old binding through normal resolution
