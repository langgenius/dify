## 1. Contract and Provider Payload Tests

- [x] 1.1 Extend IM provider contract tests to require exported `IMEventIngressKind.WEBHOOK` and `IMEventIngressKind.STREAM`, and require every `AuthenticatedIMEvent` constructor to supply `ingress_kind` without a default or legacy value.
- [x] 1.2 Add Slack adapter tests proving Webhook deliveries emit `WEBHOOK` with the complete decoded request JSON, Socket Mode deliveries emit `STREAM` with the complete `SocketModeRequest.to_dict()` serialization, and neither path creates a canonical inner payload before `IMEventConsumer`.
- [x] 1.3 Add Feishu/Lark adapter tests proving authenticated Webhook deliveries emit `WEBHOOK` with the complete decrypted Provider JSON directly, STREAM deliveries emit `STREAM` with `sdk_event.native_payload` directly, and neither payload contains the removed Dify provenance wrappers or persisted SDK class names.
- [x] 1.4 Add Slack and Feishu/Lark card decoder tests proving equivalent Webhook/STREAM callbacks produce equivalent `IMCardEvent` values, explicit ingress dispatch is used, and invalid or contract-detectable mismatched ingress/payload combinations raise `IMCardEventDecodingError` without fallback inference.
- [x] 1.5 Add Feishu/Lark stream boundary tests proving unsupported SDK object/class types are rejected before consumer delivery while supported callbacks do not persist class identity solely for decoder dispatch.

## 2. Shared Event Contract and Provider Adapters

- [x] 2.1 Add `IMEventIngressKind` and required `AuthenticatedIMEvent.ingress_kind` to the Provider-neutral contract, public exports and API stub/reference artifacts that mirror the shared surface.
- [x] 2.2 Update Slack Webhook construction to set `WEBHOOK`, Socket Mode construction to set `STREAM`, and preserve their current complete Provider-native payloads unchanged.
- [x] 2.3 Refactor `_SlackCardCodec` to branch on `event.ingress_kind`, decode Webhook payloads directly, unwrap Socket Mode envelopes only for `STREAM`, and remove ingress inference based solely on root `type == "interactive"`.
- [x] 2.4 Update Feishu/Lark Webhook construction to set `WEBHOOK` and persist authenticated decrypted Provider JSON directly; update STREAM construction to set `STREAM` and persist `sdk_event.native_payload` directly.
- [x] 2.5 Remove Feishu/Lark `_authenticated_webhook_payload`, `_authenticated_stream_payload`, their Dify-owned wrapper keys and decoder dependence on persisted `encrypted`/`object_type` provenance while retaining supported object-type validation at the stream adapter boundary.
- [x] 2.6 Refactor `_MSFeishuLarkCardCodec` to dispatch explicitly by `event.ingress_kind` and feed both direct native representations into the strict Provider callback decoder without accepting legacy wrappers or fabricating a canonical payload.
- [x] 2.7 Update Microsoft Teams and remaining production constructors, test fixtures and exact-field assertions so every `AuthenticatedIMEvent` has an explicit actual ingress kind and no caller relies on a default.

## 3. Durable Inbox Persistence

- [x] 3.1 Add unit tests for `AuthenticatedIMEvent` to `IMMessageInbox` round-trip preservation of ingress kind and complete ingress-specific `payload`, immutability through processing transitions, non-null schema enforcement and absence of a parallel `raw_payload` field.
- [x] 3.2 Add an Alembic migration that adds the enum-text ingress kind column to `im_message_inbox` as non-null and renames the `raw_payload` column to `payload`, with no server default, nullable transition, legacy value, compatibility alias or data backfill under the confirmed no-historical-data precondition.
- [x] 3.3 Add the non-null ingress kind field to the `IMMessageInbox` ORM model, rename its `raw_payload` attribute to `payload`, and map `AuthenticatedIMEvent.ingress_kind` and `AuthenticatedIMEvent.payload` in both `event_record()` and `event_from_record()` without duplicating them on `IMInboxDelivery`.
- [x] 3.4 Extend repository and Provider composition tests with different Webhook/STREAM payload shapes for the same real Provider event ID, proving cross-ingress redelivery still deduplicates only by `(provider, provider_tenant_id, provider_event_id)` and retains the first committed record's immutable ingress kind and complete payload.

## 4. Validation

- [x] 4.1 Run the focused IM provider contract, Slack payload/codec, Feishu/Lark Webhook/STREAM/payload/codec, Microsoft Teams and card decoder unit suites through `uv run --project api pytest`.
- [x] 4.2 Run the focused IM message inbox model, mapper, repository, sink, worker and Provider composition unit suites through `uv run --project api pytest`.
- [x] 4.3 Run backend formatting, linting and static type checks for the changed Python modules through the repository-supported `uv run --project api` commands.
- [ ] 4.4 Run the PostgreSQL inbox repository and Provider event-flow integration suites in CI to validate the non-null schema and cross-ingress deduplication behavior; do not treat SQLite as evidence for PostgreSQL concurrency semantics.
