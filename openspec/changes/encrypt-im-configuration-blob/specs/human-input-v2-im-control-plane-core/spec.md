## ADDED Requirements

### Requirement: IM Integration credentials MUST use one versioned opaque persistence envelope
The IM credential owner MUST serialize the complete validated resolved credential payload, including its provider discriminator, and encrypt it once with an owner-bounded cipher before persistence. Workspace Integrations MUST bind that cipher to the owning tenant and its existing provisioned key. Deployment cipher provisioning is deferred; production MUST reject deployment configuration when no deployment-bounded cipher is explicitly injected. `IMEncryptedCredentials` MUST inherit `BaseModel` directly and declare `ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)`. It MUST contain exactly `version: Literal[1]` and a non-empty `ciphertext`. `HumanInputIMIntegration.encrypted_credentials` MUST use `FrozenPydanticModelColumn(IMEncryptedCredentials)`. The column MUST NOT use a provider-specific model, `TypeAdapter`, discriminated union or `model_types`. The Integration provider, provider tenant identity and safe `app_identifier` metadata MUST remain separately persisted.

#### Scenario: A new workspace IM Integration is configured
- **WHEN** a workspace create, credential rotation or replacement accepts complete credentials for any supported IM provider
- **THEN** the resulting Integration MUST contain one recognized envelope version and one ciphertext
- **AND** every submitted provider configuration field MUST be recoverable only from that ciphertext
- **AND** the Integration MUST persist the provider and a safe `app_identifier` outside the ciphertext

#### Scenario: Deployment cipher wiring is unavailable
- **WHEN** deployment-scoped configuration is prepared without an explicitly injected deployment-bounded cipher
- **THEN** configuration MUST fail before credential testing, provider I/O or persistence
- **AND** production MUST NOT derive a deployment cipher from `DifySetup.instance_id`, `SECRET_KEY` or a synthetic Tenant

#### Scenario: An envelope row is loaded
- **WHEN** SQLAlchemy loads `HumanInputIMIntegration.encrypted_credentials`
- **THEN** `FrozenPydanticModelColumn` MUST return `IMEncryptedCredentials`
- **AND** a missing ciphertext, an empty ciphertext, an extra field or a version other than `1` MUST fail strict Pydantic validation

#### Scenario: A malformed or unsupported envelope is read
- **WHEN** an Integration contains an unknown envelope version, undecryptable ciphertext or a decrypted value that is not a valid credential object
- **THEN** the credential loader MUST reject the configuration before constructing an adapter or calling a provider
- **AND** the failure MUST NOT expose plaintext credentials, ciphertext or provider raw errors

### Requirement: Recovered IM credentials MUST match the configured provider
The credential loader MUST decrypt an envelope with an owner-bounded cipher and validate the recovered payload with the resolved credential discriminated union. Workspace runtime MUST bind the cipher to the persisted Integration tenant. Deployment runtime requires an explicitly injected deployment-bounded cipher. The provider discriminator inside the recovered payload MUST equal the persisted Integration provider.

#### Scenario: Envelope credentials are recovered for runtime work
- **WHEN** IM synchronization, delivery or event runtime needs an adapter for an Integration with a recognized envelope
- **THEN** the loader MUST decrypt the envelope once and return only the matching provider-specific resolved credential model
- **AND** the caller MUST construct the adapter from that model

#### Scenario: Deployment runtime has no bounded cipher
- **WHEN** runtime composes a tenant-less Integration without an explicitly injected deployment-bounded cipher
- **THEN** composition MUST fail before decryption, adapter construction or provider I/O

#### Scenario: Encrypted provider discriminator does not match the Integration
- **WHEN** decrypted payload provider differs from the persisted Integration provider
- **THEN** the loader MUST reject the configuration before provider I/O
- **AND** it MUST NOT reinterpret the payload as another provider's credentials

### Requirement: IM Channel projection MUST not decrypt credentials
The credential owner MUST derive `app_identifier` from validated non-secret provider configuration during a successful configuration write. IM Channel summary projection MUST use separately persisted safe metadata and MUST NOT inspect or decrypt the credential envelope.

#### Scenario: Configured IM Channels are listed
- **WHEN** a configured IM Channel is projected for collection or item read
- **THEN** its `display_identifier` MUST use `app_identifier` or the existing safe fallback
- **AND** the read MUST NOT invoke credential envelope decryption

#### Scenario: A submitted identifier is secret material
- **WHEN** a provider configuration field selected for display is an API key, secret, token, verification token or encrypt key
- **THEN** the credential owner MUST reject that field as `app_identifier`
- **AND** ChannelSummary MUST NOT expose it
