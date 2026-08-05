## 1. Close concrete Provider evidence gaps

- [ ] 1.1 Confirm the authoritative API credential, tenant-identification and baseline-permission operations for Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams.
- [ ] 1.2 Confirm each Provider's directory endpoints, configured visibility scope, pagination or organization traversal, rate-limit behavior, complete-snapshot boundary and record-inclusion rules; identify documented deletion tombstones separately from disabled, suspended, frozen or other still-present identities without introducing shared availability.
- [ ] 1.3 Confirm that each Provider can attempt personal messaging from `ProviderUserId`, including Microsoft Teams installation and private conversation-context acquisition requirements.
- [ ] 1.4 Derive a field-complete HITL-aligned normalized card intent and verify equivalent assessment, send and update semantics for Slack, Feishu/Lark and Microsoft Teams without removing unsupported form inputs before assessment.
- [ ] 1.5 Confirm Webhook authentication, challenge and response semantics for Slack, Feishu/Lark and Microsoft Teams, plus STREAM connection, callback, reconnect, stop and ACK semantics for Slack and Feishu/Lark.
- [ ] 1.6 Identify each Provider's reusable root-context client roles, explicit cleanup APIs and local-construction behavior; separately confirm that Webhook verification uses only immutable configuration and no root-owned resource, plus the STREAM SDK primitives required for thread-safe instance creation, run cancellation and close.

## 2. Implement the IMProviderAdapter root

- [ ] 2.1 Add Provider-specific typed adapter configurations without flattening API credentials, Webhook verification, encryption or STREAM connection material into a generic map.
- [ ] 2.2 Add `IMProviderAdapter` with immutable bound configuration, an optional root-owned non-STREAM API client context, `test_credentials()`, required capability views, optional capability views and idempotent root close; make close a no-op when no directly owned closeable resource exists and document every public enum member and immutable model field with concise semantic comments.
- [ ] 2.3 Add explicit concrete adapter composition for Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams without a dynamic plugin registry or generic operation dispatcher.
- [ ] 2.4 Make capability accessors side-effect free; let Directory, Basic Messaging and Dynamic Card Messaging views borrow the applicable root-owned context without closing or replacing it, while the Webhook view binds only immutable configuration and remains independent from root resources and close.
- [ ] 2.5 Document caller-managed external serialization and non-reentrancy for root, capability accessor, Directory, Messaging and Dynamic Card Messaging calls without constructor-thread affinity; allow sequential cross-thread use after safe handoff while excluding thread-safe Webhook handling, `IMEventSink.accept()` and STREAM creation from that serialization boundary. Represent configuration changes only with a new independently owned adapter without mutating, invalidating or closing the old adapter, and leave each lifecycle owner to decide whether to close its instance.
- [ ] 2.6 Add thread-safe `create_stream_events()` that depends only on immutable configuration, returns a new independent instance per supported call, returns `None` when unsupported and never registers the instance with the root.
- [ ] 2.7 Add lifecycle and boundary tests covering root-context borrowing and reuse, legal sequential cross-thread handoff, overlapping and re-entrant root-context use remaining outside the contract, close on a different thread after serialization, configuration replacement that leaves the old adapter usable and independently closeable, absence of root synchronization machinery, idempotent or noop root close, Webhook/root concurrency and close independence, independent concurrent STREAM creation and no dummy unsupported capabilities.

## 3. Implement credential testing

- [ ] 3.1 Implement `adapter.test_credentials()` for all five Providers using only adapter-bound API credentials.
- [ ] 3.2 Return normalized Provider, stable Provider tenant ID and baseline permission facts, with the minimum capability-scoped typed authentication, tenant-identification and permission failures required by callers; do not introduce a broad shared failure-code taxonomy in advance.
- [ ] 3.3 Ensure credential testing does not inspect event transport capabilities, test message-recipient reachability, mutate remote configuration or expose raw Provider responses and SDK exceptions.
- [ ] 3.4 Add concrete Provider tests for credential-test success, invalid credentials, unidentifiable tenant and missing permissions.

## 4. Implement adapter-bound Directory

- [ ] 4.1 Implement Directory for all five Providers using the applicable root-owned Provider API context and no credential or generic integration-context arguments; keep calls externally serialized with the root-context boundary and prevent the view from closing or replacing borrowed resources.
- [ ] 4.2 Keep pagination, organization traversal, rate-limit handling, cursors and raw responses inside each concrete adapter.
- [ ] 4.3 Return one immutable complete snapshot containing nominal `ProviderUserId`, optional display name and optional Email only after the entire read succeeds; make membership express current exposure in the configured scope rather than message reachability.
- [ ] 4.4 Return a typed failure and no partial snapshot when any required page, node or rate-limit wait fails.
- [ ] 4.5 Add tests for root-context borrowing and reuse, complete multi-page or hierarchy reads, missing display name or Email, confirmed deletion-tombstone omission, non-normalization of other Provider lifecycle status, late failure and no Messaging dependency.

## 5. Implement adapter-bound Messaging

- [ ] 5.1 Implement Basic Messaging `send_text` for all five Providers using the applicable root-owned Provider API context and `ProviderUserId` from the bound Provider namespace; keep calls externally serialized with the root-context boundary and prevent the view from closing or replacing borrowed resources.
- [ ] 5.2 Implement optional Dynamic Card Messaging assessment, `send_card` and exact-reference update for Slack, Feishu/Lark and Microsoft Teams only; make assessment the authoritative side-effect-free representability judgment for one complete intent.
- [ ] 5.3 Keep Provider-specific transport addressing, conversation lifecycle, CommonMark rendering, card rendering, message locator and error translation inside each concrete adapter.
- [ ] 5.4 Ensure each send attempts the requested message creation at most once and each update attempts the requested mutation at most once, returning a typed known or ambiguous outcome without automatic replay.
- [ ] 5.5 Ensure successful sends distinguish Provider acceptance from delivery and return the exact Provider-discriminated message reference.
- [ ] 5.6 Add tests for root-context borrowing and reuse, unreachable-user rejection from real sends, private addressing, text fallback, complete-intent assessment decisions, `FILE` and `FILE_LIST` returning not representable on every initial Dynamic Card Provider, no partial-card result, no dummy card capability, one-message-attempt-per-send and exact-reference updates.

## 6. Implement IM event capabilities and control inversion

- [ ] 6.1 Add framework-neutral `WebhookRequest`, `WebhookResponse`, immutable `AuthenticatedIMEvent`, `EventAcceptance`, thread-safe `IMEventSink` and stop-signal contracts.
- [ ] 6.2 Implement thread-safe Webhook Events for Slack, Feishu/Lark and Microsoft Teams as `handle(request, sink) -> response`, depending only on immutable Provider-specific configuration, owning thread-safe challenge, signature/timestamp/replay verification, decryption and Provider-specific response encoding, retaining no closeable resource between calls and never borrowing root-owned resources.
- [ ] 6.3 Ensure Webhook Events calls the sink at most once only after successful authentication, returns success only after `ACCEPTED`, and maps `RETRY` or unexpected sink failure to Provider-specific retry-compatible behavior.
- [ ] 6.4 Implement independently created `IMStreamEvents` for Slack and Feishu/Lark with terminal `NEW -> RUNNING -> CLOSED` state, at most one `run(sink, stop)` lifecycle, thread-safe idempotent `close()` from either `NEW` or `RUNNING`, and no connection establishment when `run()` observes `CLOSED`; keep SDK connection, callbacks, control frames, reconnect, stop, cleanup and ACK mapping independent from root adapter close.
- [ ] 6.5 Keep STREAM ACK ownership inside the receiving callback or connection and map the sink outcome without exposing ACK handles to downstream consumers.
- [ ] 6.6 Preserve only confirmed real Provider event IDs; never synthesize IDs from payload, timestamps, message references or ACK envelopes.
- [ ] 6.7 Keep transport credentials, HTTP response objects, connection state and SDK clients outside `AuthenticatedIMEvent`; retain immutable decrypted Provider-native payload for independent consumers.
- [ ] 6.8 Add receiver-level tests for concurrent Webhook calls on one view, Webhook overlap with root usage and close, Webhook usability after root close, absence of root-resource access, challenge and control frames, authentication failure, concurrent calls to one thread-safe sink, sink `ACCEPTED`, sink `RETRY`, unexpected sink failure, identified redelivery, missing event ID, callback ACK ownership, reconnect, stop, single-run STREAM state transitions, competing run calls, close-before-run, run/close races, repeated close, run-after-closed without connection establishment and independence from root adapter close.

## 7. Complete exhaustive Provider verification

- [ ] 7.1 Maintain a `Provider verification unit × capability operation / event entry` coverage matrix with separate unit-test, integration-test, real-execution and sanitized-fixture evidence columns. Use the five initial units Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams while retaining separate Feishu and Lark adapter-configuration tests.
- [ ] 7.2 Perform each applicable API operation or event path against an authorized non-production environment for its Provider verification unit and retain sanitized real request, response or event payload fixtures. The shared Feishu/Lark protocol evidence cells MUST use the authorized Feishu environment for real execution and fixture capture; independent Lark real execution is not required.
- [ ] 7.3 For every applicable signed or encrypted Webhook or STREAM path, regenerate cryptographically valid fixtures from sanitized plaintext using test-only material and an independent generator.
- [ ] 7.4 Cover valid verification or decryption, payload and header tampering, wrong secret or key, and applicable timestamp, replay, nonce or IV behavior for every verification-unit path; return to spec review if Feishu and Lark production paths diverge.
- [ ] 7.5 Keep any Provider verification-unit capability incomplete while one applicable evidence cell is missing. Representative Providers or shared-contract tests MUST NOT close another unit's evidence requirement; Feishu/Lark shared production paths verified through the Feishu environment are the explicit single-unit exception.
