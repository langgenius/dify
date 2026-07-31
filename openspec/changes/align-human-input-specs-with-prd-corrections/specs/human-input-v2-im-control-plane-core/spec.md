## MODIFIED Requirements

### Requirement: Effective IM binding resolution MUST hide control-plane details
Consumers MUST receive one effective binding result using priority `workspace override > organization binding > no valid IM binding` without access to encrypted credentials, provider raw payloads, or ORM identity records. Effective binding resolution MUST be scoped by current workspace, current Integration, and current authorization context. It MUST answer only which IM binding is currently effective, if any, and MUST NOT itself choose Email fallback or other delivery-channel behavior. The same provider identity MAY be reused by an organization binding and one or more workspace overrides for different Contacts; resolution MUST NOT assume that one provider identity globally maps to exactly one Contact.

#### Scenario: Workspace override exists
- **WHEN** a valid workspace binding and a valid organization binding both exist
- **THEN** resolution MUST select the workspace binding

#### Scenario: Same provider identity is reused inside one workspace override
- **WHEN** one provider identity is the organization binding for one Contact and is also configured as the workspace override for another Contact in the same workspace
- **THEN** resolution MUST use the requested workspace and target Contact context to choose the effective binding and MUST NOT reject the state merely because the provider identity is reused

#### Scenario: Same provider identity is reused across workspaces
- **WHEN** two workspaces configure overrides that reuse the same provider identity for different Contacts
- **THEN** a resolution request in one workspace MUST evaluate only that workspace-scoped override and MUST NOT invalidate the other workspace's override

#### Scenario: Workspace binding is reset
- **WHEN** the workspace override is removed or reset to global
- **THEN** resolution MUST expose the valid organization binding without copying it into workspace state

#### Scenario: No valid IM binding exists
- **WHEN** no valid workspace binding and no valid organization binding exist for the requested workspace and channel
- **THEN** resolution MUST return a stable no-valid-im-binding result and MUST NOT reinterpret that result as Email fallback inside the IM control-plane

#### Scenario: Binding provider mismatches Integration
- **WHEN** a binding or identity belongs to a different Integration/provider than the requested channel
- **THEN** resolution MUST return a stable invalid-binding result and MUST NOT expose the binding to consumers

#### Scenario: Tenant-owned Integration is requested from another workspace
- **WHEN** an Integration owner does not match the requested workspace
- **THEN** resolution MUST reject the request before loading identities, bindings, and integration-scoped resolution context
