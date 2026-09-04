## ADDED Requirements

### Requirement: Deployment credential encryption MUST expose a bound cipher capability
The system MUST define `BoundCredentialCipher` as a `Protocol` with exactly `encrypt(plaintext: str) -> bytes` and `decrypt(ciphertext: bytes) -> str` cryptographic operations. A bound cipher MUST already be associated with one deployment identity and key before it is provided to a consumer. The interface MUST NOT accept a Tenant ID, deployment ID, key reference or provider selector, and MUST NOT expose provisioning, rotation or provider-specific decoding state.

#### Scenario: A consumer encrypts and decrypts deployment credentials
- **WHEN** composition provides a consumer with a `BoundCredentialCipher` for the current deployment
- **THEN** the consumer can encrypt a string to bytes and decrypt those bytes back to the original string without supplying owner or provider information

#### Scenario: Repeated decryption reuses bound implementation state
- **WHEN** one bound cipher decrypts multiple ciphertext values for the same deployment
- **THEN** any reusable key lookup or decoding context is managed internally without widening the public interface

### Requirement: Deployment key provisioning MUST be stable and idempotent
The system MUST provision one logical credential encryption key for the stable `DifySetup.instance_id` and MUST persist its opaque reference in `DifySetup.credential_encryption_key_ref`. Provisioning MUST be edition-neutral and safe to retry. If valid key material already exists for the deployment, provisioning MUST recover or reuse it and MUST NOT replace it, generate a different logical key or make existing ciphertext undecryptable.

#### Scenario: A new installation provisions a deployment key
- **WHEN** installation has created a stable `DifySetup.instance_id` and invokes deployment key provisioning with no persisted reference
- **THEN** the configured backend creates one deployment key and the resulting opaque reference is persisted on that `DifySetup`

#### Scenario: Provisioning is retried after success
- **WHEN** provisioning is invoked for a `DifySetup` that already has a valid deployment key reference
- **THEN** it returns or preserves the same reference without creating or replacing key material

#### Scenario: Provisioning recovers from a partial prior attempt
- **WHEN** the database reference is empty but valid backend key material already exists for the same `instance_id`
- **THEN** provisioning recovers that key's reference instead of overwriting the material or creating another logical key

#### Scenario: Deployment identity is unavailable
- **WHEN** provisioning is requested without a stable `DifySetup.instance_id`
- **THEN** provisioning fails without creating key material or persisting a fabricated identity

### Requirement: Local deployment keys MUST be isolated from Tenant key material
When `KEY_PROVIDER_TYPE=local`, the system MUST store the deployment private key at `privkeys/deployments/{instance_id}/private.pem` and store its public key PEM as the opaque deployment reference. The local bound cipher MUST use that reference and path without querying a `Tenant` row. It MUST NOT read, overwrite or delete `privkeys/{tenant_id}/private.pem` or `Tenant.encrypt_public_key`.

#### Scenario: Local deployment key is created
- **WHEN** provisioning runs for a deployment using the local provider and no prior material exists
- **THEN** one RSA key pair is generated, its private key is stored under the deployment path, and its public key is persisted as the deployment reference

#### Scenario: Tenant and deployment identifiers are equal
- **WHEN** a deployment `instance_id` happens to equal an existing Tenant ID
- **THEN** their private keys still occupy distinct storage paths and neither provisioning path changes the other's key material

#### Scenario: Local private key is missing after reference persistence
- **WHEN** composition or decryption finds a persisted local deployment reference but the corresponding private key is unavailable
- **THEN** the operation fails as key unavailable and MUST NOT generate a replacement private key

### Requirement: Azure deployment keys MUST use an independent versioned key name
When `KEY_PROVIDER_TYPE=azure-keyvault`, the system MUST use the logical key name `dify-deployment-{instance_id}` and MUST keep it separate from the `dify-tenant-{tenant_id}` namespace. Encryption MUST record the exact Azure key version used to wrap each data key, and decryption MUST resolve that recorded version so old ciphertext remains readable after rotation while that version remains enabled and unexpired.

#### Scenario: Azure deployment key is provisioned
- **WHEN** provisioning runs for a deployment whose logical Azure key does not exist
- **THEN** one RSA key named `dify-deployment-{instance_id}` is created and its opaque reference is persisted

#### Scenario: Azure rotates the deployment key
- **WHEN** Azure promotes a new version after one or more credentials were encrypted
- **THEN** new ciphertext uses the new version and ciphertext created before rotation continues to decrypt through its recorded version

#### Scenario: Azure logical key already exists during retry
- **WHEN** provisioning is retried after Azure created the logical key but before the database reference was persisted
- **THEN** provisioning reuses the existing logical key without creating a new logical key or unnecessary key version

### Requirement: Cipher construction and decryption MUST never provision a key
Composition MUST construct a `BoundCredentialCipher` only from an existing stable deployment identity, persisted key reference and available backend material. Construction and decryption MUST NOT call key provisioning or replace material. Missing or incompatible references, missing key material and provider access failures MUST surface through stable credential-cipher errors without exposing plaintext, ciphertext, private key material or provider raw payloads.

#### Scenario: Bound cipher is constructed from an existing deployment key
- **WHEN** composition resolves a valid deployment identity, compatible reference and available backend material
- **THEN** it returns a cipher bound to that deployment without mutating the database or backend key lifecycle

#### Scenario: Persisted reference is absent
- **WHEN** composition is asked to construct a deployment cipher before provisioning has persisted a reference
- **THEN** construction fails as key unavailable without implicitly provisioning one

#### Scenario: Configured provider is incompatible with the persisted reference
- **WHEN** the current key provider cannot interpret the persisted deployment key reference
- **THEN** construction fails without overwriting the reference or creating replacement material

### Requirement: Deployment credential ciphertext MUST be randomized and authenticated
Every deployment `BoundCredentialCipher` implementation MUST produce authenticated, randomized ciphertext. Re-encrypting the same plaintext under the same bound cipher MUST normally produce different bytes. Decryption MUST reject malformed, truncated, tampered or wrong-deployment ciphertext and MUST never return unauthenticated or partial plaintext.

#### Scenario: The same plaintext is encrypted twice
- **WHEN** one bound cipher encrypts the same plaintext twice
- **THEN** both ciphertexts decrypt to the plaintext and the ciphertext bytes are different

#### Scenario: Ciphertext is tampered with
- **WHEN** any authenticated part of a deployment ciphertext is modified or truncated
- **THEN** decryption fails with an invalid-ciphertext error and returns no plaintext

#### Scenario: Ciphertext is opened with another deployment key
- **WHEN** ciphertext created for one deployment is passed to a cipher bound to another deployment
- **THEN** decryption fails and returns no plaintext

### Requirement: Existing Tenant encryption MUST remain behaviorally unchanged
This capability MUST NOT change the public signatures, key paths, key references, ciphertext handling or call sites of the existing Tenant credential encryption flow. Deployment key provisioning and cipher construction MUST use separate entry points and backend namespaces.

#### Scenario: Tenant credentials are encrypted after deployment cipher rollout
- **WHEN** an existing Tenant credential consumer calls the current Tenant encryption facade
- **THEN** it follows the same Tenant provider, key lookup and ciphertext behavior as before this change

#### Scenario: Deployment provisioning runs beside existing Tenant keys
- **WHEN** deployment key provisioning succeeds in an installation with existing Tenant keys
- **THEN** no Tenant key reference, private key, ciphertext or credential row is modified
