## 1. Envelope and persistence model

- [x] 1.1 Add failing unit tests for the direct `BaseModel` `IMEncryptedCredentials` schema, including its frozen strict `ConfigDict`, `version: Literal[1]`, non-empty ciphertext and extra-field rejection rules.
- [x] 1.2 Replace the field-map representation of `EncryptedCredentials` with a provider-independent envelope value, and declare `HumanInputIMIntegration.encrypted_credentials` as `FrozenPydanticModelColumn(IMEncryptedCredentials)` without a `TypeAdapter`, union or `model_types`.
- [x] 1.3 Add `app_identifier` metadata to the IM Integration domain and ORM model, and amend the unshipped schema migration to create the envelope and metadata fields.
- [x] 1.4 Simplify IM repository mappers and CAS writes so they persist opaque envelope data and `app_identifier` without parsing credential fields by provider.

## 2. Credential protection and runtime recovery

- [x] 2.1 Add failing provider-family tests that seal complete Slack, Feishu, Lark, DingTalk, Microsoft Teams and WeCom resolved credentials into one ciphertext and recover the matching typed credential model.
- [x] 2.2 Implement the owner-agnostic credential codec over `BoundCredentialCipher`, with one complete-payload cipher call and provider-mismatch or invalid-payload rejection before provider I/O.
- [x] 2.3 Update `DifyIMProviderConfigurationService` and IM management transitions to use the tenant-bound cipher for workspace create, rotation and replacement, derive only safe `app_identifier` metadata, and fail fast for deployment scope without an injected cipher.
- [x] 2.4 Route workspace IM synchronization, delivery and event adapter composition through the tenant-bound credential loader; reject tenant-less runtime without an injected deployment cipher and remove direct field-by-field reconstruction.

## 3. Remove the field-level persistence representation

- [x] 3.1 Delete the six provider-specific encrypted persistence models, their union/type adapter, exports and mapper validation paths.
- [x] 3.2 Delete field-by-field IM credential encryption/decryption and reconstruction code; verify that no legacy credential reader remains.
- [x] 3.3 Add regression coverage that every supported provider uses only the envelope representation in newly created ORM records and runtime composition.

## 4. Projection, regression coverage and validation

- [x] 4.1 Update IM Channel snapshots and summaries to read `app_identifier` metadata and add a test that collection/item projection performs no credential decryption.
- [x] 4.2 Add regression tests that malformed ciphertext and provider mismatch do not construct an adapter, invoke provider I/O, expose secret material or violate existing CAS/replacement behavior.
- [x] 4.3 Run focused API unit tests with `uv run --project api pytest api/tests/unit_tests/services/test_human_input_im_provider_configuration_service.py api/tests/unit_tests/services/test_human_input_im_integration_management_service.py api/tests/unit_tests/repositories/human_input_v2/im_integration`; run the affected CI-only repository integration contract suite in CI.
- [x] 4.4 Run `openspec validate encrypt-im-configuration-blob --strict` and update the change artifacts if validation reports an inconsistency.
