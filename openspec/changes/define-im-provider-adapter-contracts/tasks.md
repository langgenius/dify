## 1. Validate contract assumptions against Provider behavior

- [ ] 1.1 Confirm the authoritative credential-test, stable tenant-identification and baseline-permission semantics for Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams.
- [ ] 1.2 Confirm each Provider's configured directory scope, complete-snapshot boundary, canonical user identity, missing-field behavior, deletion tombstones and administrative-status semantics without exposing traversal mechanics in the shared contract.
- [ ] 1.3 Confirm that the shared `ProviderUserId` is sufficient caller input for personal messaging, including Feishu/Lark `union_id` semantics and Microsoft Teams cases where Provider transport addressing is not caller-owned.
- [ ] 1.4 Derive a field-complete HITL-aligned normalized card intent and confirm whole-intent assessment, send and exact-reference replacement semantics for Slack, Feishu/Lark and Microsoft Teams.
- [ ] 1.5 Confirm the observable Webhook authentication, challenge, response and ACK semantics for Slack, Feishu/Lark and Microsoft Teams, plus the STREAM start, stop, redelivery and ACK semantics for Slack and Feishu/Lark.
- [ ] 1.6 Revisit any shared requirement that cannot be supported by authoritative Provider behavior instead of encoding one Provider's implementation mechanism into the common interface.

## 2. Define the IMProviderAdapter contract surface

- [ ] 2.1 Add Provider-specific typed configuration boundaries without flattening credentials or event-transport material into a generic map.
- [ ] 2.2 Add immutable Provider-neutral values and typed results for credential testing, capability discovery and failure reporting.
- [ ] 2.3 Add non-thread-safe `IMProviderAdapter` with bound configuration, required and optional capability views, Webhook and STREAM factories and idempotent root close.
- [ ] 2.4 Document caller-observable construction, configuration replacement, external serialization, absence of a shared cross-thread handoff guarantee, non-reentrancy, post-close and independent event-transport lifecycle semantics.
- [ ] 2.5 Ensure the shared contract exposes no `ProviderClientContext`, SDK client, HTTP session, cache, rate limiter, lock, atomic primitive, callback handle or internal resource-ownership model.
- [ ] 2.6 Add contract-surface tests covering capability availability, side-effect-free capability access, typed configuration isolation, external serialization and normalized safe failures.

## 3. Define Directory and Messaging contracts

- [ ] 3.1 Add Directory protocols and immutable snapshot values with minimal `ProviderUserId`, display-name and Email facts.
- [ ] 3.2 Define complete-snapshot success, no-partial-result failure and Provider namespace semantics without specifying pagination, hierarchy traversal or accumulation algorithms.
- [ ] 3.3 Add Basic Messaging `send_text` contracts for all five Providers and optional Dynamic Card Messaging contracts for Slack, Feishu/Lark and Microsoft Teams.
- [ ] 3.4 Define complete-intent assessment, `FILE` and `FILE_LIST` non-representability, `DynamicCardMessagingError` for an unrepresentable intent passed to `send_card`, confirmed Provider acceptance, unified unconfirmed-acceptance failure and exact-reference `ReplacementErrorKind`/`ReplacementError` results.
- [ ] 3.5 Define the at-most-once mutation-attempt and no-automatic-replay behavior without prescribing Provider-specific prerequisite operations or retry implementation.
- [ ] 3.6 Add black-box contract tests using test doubles for snapshot completeness, identity namespace, capability absence, assessment, `DynamicCardMessagingError`, send outcomes and exact-reference replacements.

## 4. Define inbound event contracts

- [ ] 4.1 Add framework-neutral `WebhookRequest`, `WebhookResponse`, immutable `AuthenticatedIMEvent`, `EventAcceptance` and thread-safe `IMEventConsumer` contracts.
- [ ] 4.2 Define thread-safe Webhook request handling, authentication-before-consumer, challenge behavior and ACK-after-`ACCEPTED` semantics without prescribing verification or resource-management implementation.
- [ ] 4.3 Define independently created `IMEventStream` instances as owner-managed resources with synchronous one-shot `start()`, synchronous idempotent `stop()`, normalized lifecycle failures, in-flight event and protocol-response draining, owned-resource release, event-failure isolation and root-close independence semantics.
- [ ] 4.4 Keep transport implementation context not defined by the shared contract and consumer-specific models outside `AuthenticatedIMEvent` without removing fields from decoded Webhook JSON or supported Provider SDK serialization.
- [ ] 4.5 Preserve only confirmed stable Provider event IDs; define Webhook payload as the complete decoded HTTP request body JSON model and STREAM payload as the complete supported SDK serialization for independent consumer decoding.
- [ ] 4.6 Add black-box contract tests using test doubles for concurrent consumer calls, Webhook/root overlap, consumer outcomes, one-shot STREAM start, graceful idempotent stop, event-failure isolation and independent lifecycles.

## 5. Complete real Provider evidence

- [ ] 5.1 Maintain a `Provider verification unit × capability operation / event entry` matrix with authoritative-source, real-execution and sanitized-fixture evidence columns. Use Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams as the initial verification units.
- [ ] 5.2 Perform every applicable API operation or event path against an authorized non-production environment and retain a complete sanitized real request, response or event payload fixture. Shared Feishu/Lark protocol paths MUST use the authorized Feishu environment for real execution and fixture capture.
- [ ] 5.3 Independently verify Feishu and Lark typed configuration, Provider discriminator and API host mapping even when their production protocol evidence is shared.
- [ ] 5.4 For every applicable signed or encrypted Webhook or STREAM path, regenerate a cryptographically valid fixture from sanitized plaintext using test-only material and cover valid verification or decryption, tampering, wrong material and applicable freshness or replay behavior.
- [ ] 5.5 Keep a Provider contract cell unresolved while required real-execution or fixture evidence is missing. If Feishu and Lark production paths or protocol semantics diverge, return to spec review instead of reusing shared evidence.
- [ ] 5.6 Record Provider facts and contract conclusions without adding SDK selection, client sharing, locking, caching, connection management or cleanup requirements to the shared specs.

## 6. Validate the contract package

- [ ] 6.1 Run the focused contract tests and static checks for the Provider-neutral package.
- [ ] 6.2 Verify that the contract package has no imports from concrete Provider SDKs, persistence, queueing, controller or business-consumer implementations, while allowing the explicit `FrozenFormDefinition` dependency required by `NormalizedCardIntent`.
- [ ] 6.3 Run `openspec validate define-im-provider-adapter-contracts --type change --strict` and resolve every validation error.
