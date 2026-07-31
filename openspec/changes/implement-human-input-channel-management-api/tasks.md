## 1. Establish Canonical Console DTOs And Mapping

- [x] 1.1 Add strict Pydantic path, request, persisted-view, candidate-test, collection-failure and error DTOs for only `email/resend`, `im/slack`, `im/feishu` and `im/ding_talk`.
- [x] 1.2 Add DTO tests for complete route/body discriminator matching, rejected extra fields, unsupported providers and explicit Email key directives.
- [x] 1.3 Add mapper tests proving persisted views and reserved candidate-test results remain separate and every serialized response is credential-free.
- [x] 1.4 Implement transport-to-command and result-to-response mappers without provider or persistence access.
- [x] 1.5 Define and test stable HTTP mapping, including malformed or non-JSON request bodies.

## 2. Preserve Provider Connectivity Boundaries

- [x] 2.1 Keep provider-dependent Resend save and test behavior outside this change.
- [x] 2.2 Keep Slack, Feishu and DingTalk provider connectivity, identity resolution, credential protection and persistence wiring unimplemented.
- [x] 2.3 Return `resend_provider_connectivity_not_implemented` for Resend save/test before repository, credential or provider work.
- [x] 2.4 Return `im_channel_management_not_implemented` for every IM operation before infrastructure work.
- [x] 2.5 Add tests proving all provider-dependent production operations are explicit stubs and perform no database or provider work.

## 3. Compose The Control-Plane API

- [ ] 3.1 Add a request-scoped composition module with the Email repository, provider-independent Resend read/delete behavior, three IM placeholders, registry and facade.
- [x] 3.2 Add composition tests proving exactly four complete refs are registered and duplicate refs fail fast.
- [x] 3.3 Add a trusted-context factory for Community and Cloud Workspace and actor facts while leaving shared IM ownership fields unset.
- [x] 3.4 Add import-boundary tests proving controllers and DTO mappers do not import channel ORM records or provider SDKs and composition imports no provider SDK/HTTP client.
- [x] 3.5 Add query-count assertions for collection reads and prove list/get perform no provider I/O.

## 4. Implement Canonical Channels Controllers

- [x] 4.1 Retain the existing Owner/Admin route guards and test strict ownership-field rejection plus trusted actor Email selection.
- [x] 4.2 Add collection tests for the Resend view followed by isolated Slack, Feishu and DingTalk placeholder failures.
- [x] 4.3 Add Resend DTO/mapper coverage and explicit provider-dependent unimplemented response coverage.
- [x] 4.4 Implement collection and complete-ref resources using only DTO mapping, trusted-context construction, facade calls and stable response mapping.
- [x] 4.5 Add one pre-dispatch edition guard that returns HTTP `501` for every canonical Channels path on Enterprise before route or service work.

## 5. Retire Duplicate Contracts

- [x] 5.1 Leave `human-input-v2-api-contracts` unchanged because its IM authority is outside this API change.
- [x] 5.2 Leave `implement-im-contact-sync-api` unchanged because provider sync and Contact binding are outside this API change.
- [x] 5.3 Remove the obsolete Email provider route while retaining existing IM stubs and DTO variants.
- [x] 5.4 Update manual Console API documentation with the canonical routes, provider-connectivity boundary and stable errors.
- [x] 5.5 Add compatibility tests proving Contact, sync and migration routes remain registered and unchanged.

## 6. Validate And Handoff

- [x] 6.1 Run focused DTO, mapper, composition, service, repository and controller suites without live provider credentials.
- [x] 6.2 Run backend formatting, linting and type checking for every affected file.
- [x] 6.3 Audit request/response models and exception paths for credential leakage.
- [x] 6.4 Confirm no provider implementation, schema migration, frontend wiring, directory sync, OAuth/callback flow or Enterprise deployment-wide IM access entered this implementation.
- [x] 6.5 Validate `implement-human-input-channel-management-api` with strict OpenSpec validation.
