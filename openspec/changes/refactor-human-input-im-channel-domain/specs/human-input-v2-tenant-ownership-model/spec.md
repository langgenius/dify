## MODIFIED Requirements

### Requirement: HITLv2 MUST use canonical tenant owner terminology

HITLv2 values、model attributes and ports that directly carry Dify `Tenant.id` MUST use `TenantId` / `tenant_id`。`WorkspaceId` / `workspace_id` MUST NOT remain as aliases。`IMChannel` is owner-free；`WorkspaceIMChannelRepository` accepts `TenantId` only in its constructor and derives private persistence key `workspace:<tenant_id>`。

#### Scenario: Workspace IM Channel Repository is constructed

- **WHEN** persistence composition constructs `WorkspaceIMChannelRepository` for one Dify Tenant
- **THEN** its constructor MUST accept `TenantId`
- **AND** `IMChannel` returned by the Repository MUST remain owner-free
- **AND** raw `owner_key` MUST remain private persistence data

### Requirement: IM Channel owner key MUST remain distinct from Provider tenant identity

`HumanInputIMChannel.owner_key` MUST represent only the Dify Channel owner slot。It MUST NOT replace or reinterpret `provider_tenant_id` or another Provider-native identifier。

#### Scenario: IM Channel is mapped

- **WHEN** Repository maps `HumanInputIMChannel` to `IMChannel`
- **THEN** it MUST omit `owner_key` from the Channel value
- **AND** it MUST preserve `provider_tenant_id` as the opaque Provider namespace

### Requirement: Tenant terminology migration MUST NOT require an unrelated schema change

The tenant-terminology migration itself MUST NOT require a schema migration。The independent IM Channel Repository MAY replace the unpublished nullable `tenant_id` owner column with non-null unique `owner_key` because that column enforces workspace/deployment singleton persistence。No published Channel row requires backfill。

#### Scenario: New IM Channel schema is created

- **WHEN** the unpublished IM configuration table is replaced by `human_input_im_channels`
- **THEN** it MUST use `owner_key` as defined by the IM Channel Repository change
- **AND** this exception MUST NOT introduce `workspace_id` or another tenant alias
