## ADDED Requirements

### Requirement: Synced IM identities MUST be managed through contact-scoped APIs

系统 MUST 通过现有 contact-scoped 管理入口暴露已同步 IM identities 的搜索与写入能力，而不是新增厂商专属 binding API。identity 搜索、binding 创建 / 删除、workspace override 设置 / 清除都 MUST 保持 provider-agnostic。

#### Scenario: Search synced identities by provider user ID
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-identities?keyword=<provider-user-id>`
- **THEN** the system MUST search the synchronized identity set through the unified identity-search endpoint

#### Scenario: Bind one identity to a contact
- **WHEN** a workspace owner or admin calls `PUT /console/api/workspaces/current/human-input/contacts/<contact_id>/im-bindings`
- **THEN** the system MUST bind the selected synced identity through the existing contact-scoped binding endpoint rather than a provider-specific route

#### Scenario: Delete one binding from a contact
- **WHEN** a workspace owner or admin calls `DELETE /console/api/workspaces/current/human-input/contacts/<contact_id>/im-bindings?binding_id=<binding-id>`
- **THEN** the system MUST remove the binding through the same contact-scoped management surface

### Requirement: Contact IM bindings MUST attach only to current non-external contacts

系统 MUST 只允许把同步得到的 IM identity 绑定到当前 workspace 中可解析的 `WORKSPACE` 或 `PLATFORM` contact。`External contact`、`ABSENT` contact、hard-deleted contact 或其他 unavailable subject MUST 被拒绝，系统 MUST NOT 通过绑定写路径隐式创建或恢复 Contact。

#### Scenario: Bind to a workspace or platform contact
- **WHEN** the target contact currently resolves as `WORKSPACE` or `PLATFORM`
- **THEN** the system MUST allow the IM binding write if the selected identity is valid for the current integration

#### Scenario: Bind to an external contact
- **WHEN** the target contact resolves as `EXTERNAL`
- **THEN** the system MUST reject the request because external contacts remain email-only in the current business scope

#### Scenario: Bind to an absent or deleted contact
- **WHEN** the target contact resolves as `ABSENT` or has been hard-deleted
- **THEN** the system MUST reject the request and MUST NOT recreate the contact or its availability

### Requirement: Unmatched sync results MUST remain read-only contact facts

manual sync 未命中的 provider entry MUST 只作为后续人工处理的 sync result 保留。系统 MUST NOT 因为 unmatched 条目而自动创建 `External contact`、自动写入 IM binding，或把 provider identity 直接提升成 Contact。

#### Scenario: Viewing an unmatched provider entry
- **WHEN** a latest sync result item is classified as `not_matched`
- **THEN** the system MUST expose it as a read-only sync result without creating a contact or binding side effect

#### Scenario: Attempting to bind through unmatched status alone
- **WHEN** a client only knows an unmatched sync result item but no current eligible contact exists
- **THEN** the system MUST require the operator to resolve an existing eligible contact first and MUST NOT auto-admit a new contact

### Requirement: Workspace override MUST remain distinct from organization binding

workspace IM override 和 organization binding MUST 是两条不同的写路径。设置 workspace override MUST NOT 改写 organization binding；清除 workspace override MUST 回退到现有 global binding 解析结果，而不是复制或重建 organization binding。

#### Scenario: Set one workspace override in EE
- **WHEN** an EE workspace admin calls `PUT /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override`
- **THEN** the system MUST store a workspace-scoped override without modifying the organization-scoped binding

#### Scenario: Reset one workspace override
- **WHEN** an EE workspace admin calls `DELETE /console/api/workspaces/current/human-input/contacts/<contact_id>/im-override`
- **THEN** the system MUST remove only the workspace override and MUST expose the global binding again through normal resolution

#### Scenario: Override is unsupported in CE or SaaS
- **WHEN** a CE or SaaS workspace calls the workspace-override endpoint and the deployment does not support workspace-local overrides
- **THEN** the system MAY reject the request with an edition-not-supported style error instead of emulating EE-only workspace override behavior

### Requirement: Sync-written bindings MUST flow back into the existing effective-binding resolver

任何通过 identity binding 或 workspace override 写入的 current state，都 MUST 继续由现有 effective-binding resolution 规则消费，即 `workspace override > organization binding > Email fallback`。provider adapter、controller 和 UI MUST NOT 额外实现一套平行解析逻辑。

#### Scenario: Workspace override wins over organization binding
- **WHEN** a contact has both a valid workspace override and a valid organization binding
- **THEN** the current effective-binding resolver MUST return the workspace override

#### Scenario: Global binding remains after override reset
- **WHEN** the workspace override is deleted while the organization binding remains valid
- **THEN** the current effective-binding resolver MUST fall back to the organization binding without copying it into workspace scope

#### Scenario: Binding becomes invalid after integration replacement
- **WHEN** the current integration is replaced and existing bindings are invalidated
- **THEN** the effective-binding resolver MUST stop exposing the old binding through normal resolution
