## ADDED Requirements

### Requirement: IM Identity persistence MUST use Channel as its only parent

`HumanInputIMIdentity` MUST store non-null `channel_id` and non-blank `provider_user_id`. The schema MUST enforce `UNIQUE(channel_id, provider_user_id)`. It MUST NOT store the Channel owner, workspace/deployment discriminator, raw owner key, Provider, or Provider tenant ID.

#### Scenario: Workspace-owned Channel Identity is stored
- **WHEN** synchronization creates an Identity through a workspace-owned current Channel
- **THEN** the Identity row MUST store that Channel ID and Provider user ID
- **AND** the row MUST NOT store the owning tenant or a workspace discriminator

#### Scenario: Deployment-owned Channel Identity is stored
- **WHEN** synchronization creates an Identity through a deployment-owned current Channel
- **THEN** the Identity row MUST use the same schema as the workspace-owned case
- **AND** the row MUST NOT store a deployment discriminator

#### Scenario: Provider user is duplicated inside one Channel
- **WHEN** two writes create the same Provider user ID under one Channel
- **THEN** the database MUST allow at most one current Identity row

#### Scenario: Provider user appears in different Channels
- **WHEN** the same Provider user ID is observed through two different Channels
- **THEN** each Channel MAY have its own current Identity row

### Requirement: IM Identity persistence MUST keep current query facts in canonical columns

`HumanInputIMIdentity` MUST persist display name, normalized name, email, normalized email, opaque raw Provider payload, latest sync run ID, latest observation timestamp, and standard row timestamps. Repository mapping MUST write each source/normalized pair as both null or both non-null. Latest sync run ID and latest observation timestamp MUST be non-null for a current Identity. The schema MUST declare `IMIdentityRawPayload` directly as `RootModel[dict[str, JsonValue]]` with frozen, strict, and default-validation configuration; it MUST NOT reuse the existing `_ImmutableJSONObject` base or another raw-payload definition.

#### Scenario: Provider observation contains blank optional values
- **WHEN** synchronization records blank display name or email text
- **THEN** Repository mapping MUST persist both the source and normalized field as null

#### Scenario: Provider observation contains current profile values
- **WHEN** synchronization records non-blank display name and email
- **THEN** Repository mapping MUST persist stripped source values and their canonical normalized values
- **AND** it MUST persist the exact opaque diagnostic payload without exposing it in the current Domain value

#### Scenario: Raw payload model is declared
- **WHEN** the Identity schema defines its raw Provider payload type
- **THEN** `IMIdentityRawPayload` MUST use `ConfigDict(frozen=True, strict=True, validate_default=True)`
- **AND** it MUST accept exactly one JSON object root value

#### Scenario: Identity has no observation
- **WHEN** a caller attempts to persist a current Identity without sync run ID or observation timestamp
- **THEN** persistence MUST reject the row

### Requirement: Current IM Identity values MUST hide persistence context

`IMIdentity` MUST contain Identity ID, Provider user ID, display name, email, latest sync run ID, latest observation timestamp, creation timestamp, and update timestamp. It MUST NOT contain Channel ID, Provider, Provider tenant ID, normalized fields, raw payload, owner key, tenant ID, workspace/deployment discriminator, or ORM state.

#### Scenario: Workspace and deployment Identities are loaded
- **WHEN** owner-bound composition loads one current Identity from each Channel kind
- **THEN** both Repository implementations MUST return the same `IMIdentity` shape
- **AND** neither value MUST reveal how its Channel is owned

#### Scenario: Identity is returned to a current consumer
- **WHEN** a consumer receives `IMIdentity`
- **THEN** it MUST be able to use current safe profile and last-seen facts without reading ORM state or raw Provider payload

### Requirement: IM Identity observations MUST derive persistence-only query values

`IMIdentityObservation` MUST carry Provider user ID, optional display name, optional email, opaque raw payload, sync run ID, and observation timestamp. `OpaqueProviderPayload` MUST be declared directly as `RootModel[dict[str, JsonValue]]` with frozen, strict, and default-validation configuration; it MUST NOT use an intermediate serialized-string wrapper or reuse `IMIdentityRawPayload`. Identity Writer implementations MUST derive normalized name and email columns from the observation. Callers MUST NOT provide normalized persistence columns.

#### Scenario: Observation raw payload model is declared
- **WHEN** the Identity Repository contract defines `OpaqueProviderPayload`
- **THEN** it MUST use `ConfigDict(frozen=True, strict=True, validate_default=True)`
- **AND** it MUST accept exactly one JSON object root value

#### Scenario: Observation creates an Identity
- **WHEN** `IMIdentityRepository.create` receives a new Identity ID and one observation
- **THEN** the Writer MUST persist a complete current row under its bound Channel
- **AND** it MUST return the mapped owner-free `IMIdentity`

#### Scenario: Observation updates an Identity
- **WHEN** `IMIdentityRepository.update` receives an Identity ID current in its bound Channel
- **THEN** the Writer MUST refresh profile, raw payload, last-seen facts, normalized columns, and update timestamp
- **AND** it MUST preserve Identity ID, Channel ID, Provider user ID, and creation timestamp

### Requirement: IM Identity Repository MUST be Channel-bound

`IMIdentityRepository` MUST expose `get`, `get_by_provider_user_id`, `list_all`, paginated `search`, `create`, `update`, and `delete`. Its methods MUST NOT accept Channel ID, owner, scope, workspace/deployment discriminator, actor, Provider, raw owner key, SQLAlchemy Session, or ORM row.

#### Scenario: Identity ID belongs to another Channel
- **WHEN** the Repository receives an Identity ID that exists only under another Channel
- **THEN** it MUST return the same missing outcome as an unknown Identity ID
- **AND** it MUST NOT return or mutate the foreign row

#### Scenario: Identity search runs
- **WHEN** a caller searches the bound Channel with a keyword and valid page parameters
- **THEN** the Reader MUST apply the keyword to Provider user ID, display name, and email
- **AND** it MUST return only owner-free Identities from the bound Channel

### Requirement: IM Identity writes MUST expose narrow stable conflicts

Expected Identity persistence failures MUST derive from one `IMIdentityRepositoryError` root that derives directly from `Exception`. Duplicate Provider user creation MUST produce `IMIdentityAlreadyExistsError`; missing or foreign Identity writes MUST produce `IMIdentityNotFoundError`; delete while either current Binding table references the Identity MUST produce `IMIdentityInUseError`.

#### Scenario: Identity is still bound
- **WHEN** `IMIdentityRepository.delete` addresses an Identity referenced by a default Binding or workspace override
- **THEN** it MUST raise `IMIdentityInUseError`
- **AND** it MUST leave Identity and Binding rows unchanged

#### Scenario: Unexpected integrity failure occurs
- **WHEN** persistence encounters an integrity failure unrelated to the classified Provider-user uniqueness constraint
- **THEN** the adapter MUST preserve the original failure
- **AND** it MUST NOT misclassify it as an expected Identity conflict

### Requirement: IM Identity SQLAlchemy stubs MUST use caller-owned Sessions

The SQLAlchemy Identity adapter stub MUST bind caller-provided `Session` and trusted `IMChannelId` at construction. Methods MAY query, perform DML, and flush when implemented. They MUST NOT create a Session, commit, rollback, begin a nested transaction, acquire an external lock, perform Provider I/O, or dispatch work.

#### Scenario: Identity adapter is constructed
- **WHEN** composition has loaded the current Channel through the correct owner-bound Channel Reader
- **THEN** it MAY construct `SQLAlchemyIMIdentityRepository(session, channel.id)`
- **AND** no later Identity operation MUST accept another owner or Channel ID

#### Scenario: Identity write is rolled back
- **WHEN** the caller rolls back the surrounding transaction after a successful Identity flush
- **THEN** the complete Identity mutation MUST be rolled back
