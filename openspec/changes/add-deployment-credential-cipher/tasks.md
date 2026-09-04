## 1. Contract and persistence

- [ ] 1.1 Add failing unit tests that assert `BoundCredentialCipher` exposes only `encrypt(plaintext: str) -> bytes` and `decrypt(ciphertext: bytes) -> str`, with no owner or lifecycle arguments.
- [ ] 1.2 Add migration tests for a nullable `DifySetup.credential_encryption_key_ref` column on supported database dialects.
- [ ] 1.3 Add the `BoundCredentialCipher` Protocol, stable cipher/key-unavailable error types, the ORM field and its database migration without changing the existing Tenant encryption interfaces.

## 2. Deployment key provisioning

- [ ] 2.1 Add provider-neutral provisioning tests for missing `instance_id`, first creation, retry after persisted success, recovery after external-material-only partial success, edition-neutral behavior and absence of Tenant key mutations.
- [ ] 2.2 Implement the deployment key provisioning entry point that locks/resolves the stable `DifySetup`, preserves an existing reference and delegates backend material creation or recovery without using a key registry.
- [ ] 2.3 Add failing local-provider tests for `privkeys/deployments/{instance_id}/private.pem`, public-reference recovery, namespace isolation from Tenant keys and refusal to overwrite existing valid private material.
- [ ] 2.4 Implement idempotent local deployment key provisioning by reusing the existing low-level RSA/AES primitives without changing Tenant key paths or behavior.
- [ ] 2.5 Add failing Azure tests for `dify-deployment-{instance_id}`, retry after a partial attempt, independent Tenant/deployment namespaces, configured rotation policy and reuse without an unnecessary new key version.
- [ ] 2.6 Implement idempotent Azure deployment key provisioning and persist its opaque deployment reference while preserving existing Tenant Azure provider behavior.

## 3. Bound cipher implementations and composition

- [ ] 3.1 Add shared contract tests for local and Azure bound ciphers covering round-trip, randomized ciphertext, tamper/truncation rejection, wrong-deployment rejection and repeated decryption through one bound instance.
- [ ] 3.2 Implement the local deployment `BoundCredentialCipher` using the persisted public reference and deployment private-key locator, with internal lazy decoding-context reuse and no ORM Tenant lookup.
- [ ] 3.3 Implement the Azure deployment `BoundCredentialCipher` with per-ciphertext key-version metadata, old-version decryption after rotation and provider error translation.
- [ ] 3.4 Add composition tests that construct a bound cipher only from an existing compatible reference and fail without provisioning when the setup row, identity, reference, backend material or configured provider is invalid.
- [ ] 3.5 Implement the deployment cipher composition builder and keep Base64, JSON, credential schemas and concrete EE consumers outside this change.

## 4. Installation lifecycle

- [ ] 4.1 Add account setup tests showing a new installation provisions and persists one deployment key while a retry preserves the same logical key and setup failure does not fabricate a replacement identity.
- [ ] 4.2 Wire deployment key provisioning into new-install setup after a stable `DifySetup.instance_id` exists; leave migrated existing rows nullable for explicit idempotent provisioning before future use.

## 5. Regression coverage and validation

- [ ] 5.1 Add regression tests that existing local/Azure Tenant provisioning, `core.helper.encrypter`, private-key paths, ciphertext handling and credential consumers remain behaviorally unchanged.
- [ ] 5.2 Run focused API unit tests for the new Protocol, migration, provisioning, local/Azure ciphers, composition and account setup with `uv run --project api pytest <focused-test-paths>`.
- [ ] 5.3 Run the existing Tenant encryption and Azure Key Vault unit suites, then run affected backend integration contracts in CI because integration tests are CI-only.
- [ ] 5.4 Run backend lint/type checks for affected modules and `openspec validate add-deployment-credential-cipher --strict`; update artifacts if validation reports a contract mismatch.
