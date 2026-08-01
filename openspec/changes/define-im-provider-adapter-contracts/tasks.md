## 1. Close concrete Provider evidence gaps

- [ ] 1.1 Confirm the authoritative API credential, tenant-identification and baseline-permission operations for Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams.
- [ ] 1.2 Confirm each Provider's directory endpoints, configured visibility scope, pagination or organization traversal, rate-limit behavior and complete-snapshot boundary.
- [ ] 1.3 Confirm each Provider's proactive message-destination shape and lifecycle, especially Microsoft Teams installation and conversation context requirements.
- [ ] 1.4 Derive a field-complete normalized generic card intent and verify equivalent assessment, send and update semantics for Slack, Feishu/Lark and Microsoft Teams.
- [ ] 1.5 Confirm Webhook authentication, challenge and response semantics for all five Providers, plus STREAM connection, callback, reconnect, stop and ACK semantics for Slack, Feishu/Lark and DingTalk.
- [ ] 1.6 Record each Provider SDK client's concurrency guarantees and determine whether the concrete adapter needs serialization, pooling or distinct client roles.

## 2. Implement the IMProviderAdapter root

- [ ] 2.1 Add Provider-specific typed adapter configurations without flattening API credentials, Webhook verification, encryption or STREAM connection material into a generic map.
- [ ] 2.2 Add `IMProviderAdapter` with immutable bound configuration, adapter-owned client context, `test_credentials()`, required capability views, optional capability views and idempotent close.
- [ ] 2.3 Add explicit concrete adapter composition for Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams without a dynamic plugin registry or generic operation dispatcher.
- [ ] 2.4 Make all capability accessors side-effect free and ensure they return views backed by the same adapter-owned context rather than constructing SDK clients.
- [ ] 2.5 Represent configuration changes by constructing a new adapter and closing the old adapter; reject capability calls after close without rebuilding resources.
- [ ] 2.6 Add lifecycle and boundary tests covering one-time or lazy-memoized client-role construction, cross-capability reuse, concurrent access policy, idempotent close and no dummy unsupported capabilities.

## 3. Implement credential testing

- [ ] 3.1 Implement `adapter.test_credentials()` for all five Providers using only adapter-bound API credentials.
- [ ] 3.2 Return normalized Provider, stable Provider tenant ID and baseline permission facts, with typed authentication, tenant-identification and permission failures.
- [ ] 3.3 Ensure credential testing does not inspect event transport capabilities, test message destinations, mutate remote configuration or expose raw Provider responses and SDK exceptions.
- [ ] 3.4 Add concrete Provider tests for credential-test success, invalid credentials, unidentifiable tenant and missing permissions.

## 4. Implement adapter-bound Directory

- [ ] 4.1 Implement Directory for all five Providers using the root-owned client context and no credential or generic integration-context arguments.
- [ ] 4.2 Keep pagination, organization traversal, rate-limit handling, cursors and raw responses inside each concrete adapter.
- [ ] 4.3 Return one immutable complete snapshot containing provider user ID, display name, optional Email and availability only after the entire read succeeds.
- [ ] 4.4 Return a typed failure and no partial snapshot when any required page, node or rate-limit wait fails.
- [ ] 4.5 Add tests for cross-capability client reuse, complete multi-page or hierarchy reads, missing Email, late failure and no Messaging dependency.

## 5. Implement adapter-bound Messaging

- [ ] 5.1 Implement Basic Messaging `test_destination` and `send_text` for all five Providers using root-owned clients and explicit Provider message destinations.
- [ ] 5.2 Implement optional Dynamic Card Messaging assessment, `send_card` and exact-reference update for Slack, Feishu/Lark and Microsoft Teams only.
- [ ] 5.3 Keep Provider-specific destination, CommonMark rendering, card rendering, message locator and error translation inside each concrete adapter.
- [ ] 5.4 Ensure one side-effecting method invocation makes at most one Provider call and returns a typed known or ambiguous outcome without automatic replay.
- [ ] 5.5 Ensure successful sends distinguish Provider acceptance from delivery and return the exact Provider-discriminated message reference.
- [ ] 5.6 Add tests for client reuse, destination reachability, text fallback, side-effect-free card assessment, no dummy card capability, one-call-per-invocation and exact-reference updates.

## 6. Implement IM event capabilities and control inversion

- [ ] 6.1 Add framework-neutral `WebhookRequest`, `WebhookResponse`, immutable `AuthenticatedIMEvent`, `EventAcceptance`, `IMEventSink` and stop-signal contracts.
- [ ] 6.2 Implement Webhook Events for all five Providers as `handle(request, sink) -> response`, owning challenge, signature/timestamp/replay verification, decryption and Provider-specific response encoding.
- [ ] 6.3 Ensure Webhook Events calls the sink at most once only after successful authentication, returns success only after `ACCEPTED`, and maps `RETRY` or unexpected sink failure to Provider-specific retry-compatible behavior.
- [ ] 6.4 Implement STREAM Events for Slack, Feishu/Lark and DingTalk as `run(sink, stop)`, owning SDK connection establishment, callbacks, control frames, reconnect, stop and ACK mapping.
- [ ] 6.5 Keep STREAM ACK ownership inside the receiving callback or connection and map the sink outcome without exposing ACK handles to downstream consumers.
- [ ] 6.6 Preserve only confirmed real Provider event IDs; never synthesize IDs from payload, timestamps, message references or ACK envelopes.
- [ ] 6.7 Keep transport credentials, HTTP response objects, connection state and SDK clients outside `AuthenticatedIMEvent`; retain immutable decrypted Provider-native payload for independent consumers.
- [ ] 6.8 Add receiver-level tests for challenge and control frames, authentication failure, sink `ACCEPTED`, sink `RETRY`, unexpected sink failure, identified redelivery, missing event ID, callback ACK ownership, reconnect and stop behavior.

## 7. Complete exhaustive Provider verification

- [ ] 7.1 Maintain a `Provider × capability operation / event entry` coverage matrix with separate unit-test, integration-test, real-execution and sanitized-fixture evidence columns.
- [ ] 7.2 Perform each applicable API operation or event path against an authorized non-production Provider environment and retain sanitized real request, response or event payload fixtures.
- [ ] 7.3 For every applicable signed or encrypted Webhook or STREAM path, regenerate cryptographically valid fixtures from sanitized plaintext using test-only material and an independent generator.
- [ ] 7.4 Cover valid verification or decryption, payload and header tampering, wrong secret or key, and applicable timestamp, replay, nonce or IV behavior for every concrete path.
- [ ] 7.5 Keep any Provider capability incomplete while one applicable evidence cell is missing; representative Providers or shared-contract tests MUST NOT close another Provider's evidence requirement.
