## 1. Prerequisites

- [ ] 1.1 Require completed Channel Management contracts for `IMChannel`、`WebhookId`、transport mode and callback URL generation；do not duplicate their implementation here.

## 2. Migrate inbox routing to Channel identity

- [ ] 2.1 Change inbox contracts、ORM and the unpublished migration from `integration_id` to non-null `channel_id: IMChannelId` without a compatibility alias、dual read/write or backfill.
- [ ] 2.2 Update repository、mappers、`IMMessageInboxSink`、`IMInboxDelivery` and worker routing to use Channel ID.
- [ ] 2.3 Keep deduplication on `(provider, provider_tenant_id, provider_event_id)` and add behavior tests proving duplicate resolution preserves the first record's Channel ID.

## 3. Channel lookup and ingress service

- [ ] 3.1 Add `IMWebhookChannelRoute(channel, credential_scope)` and `IMWebhookChannelRepository.find_by_webhook_id()`，then implement the detached SQLAlchemy reverse lookup with `None` for not found and a raised failure for query or mapping errors.
- [ ] 3.2 Add repository tests for a current route、an absent route、an invalid persisted owner scope and a query failure.
- [ ] 3.3 Add `IMProviderBuilder` with `build(channel: IMChannel) -> IMProviderAdapter`，binding one `BoundCredentialCipher` in its constructor and reusing `IMCredentialCodec` plus `build_im_provider_adapter()` internally without accepting a route or credential scope.
- [ ] 3.4 Add Builder tests for successful credential recovery、invalid envelopes、Provider mismatch、adapter-construction failure and independent adapters from repeated `build()` calls.
- [ ] 3.5 Implement `IMWebhookIngressService.handle()` by resolving an owner-bound `IMProviderBuilder` from `route.credential_scope`，calling `builder.build(route.channel)` and constructing a Channel-bound `IMMessageInboxSink`.
- [ ] 3.6 Use `adapter.create_webhook_handler()` as the runtime Webhook capability authority；return `404` when it returns `None` and close the request-scoped adapter after use.
- [ ] 3.7 Return `404` for unknown routes and unavailable handlers；return `503` for route lookup、Builder resolution、credential or handler-construction failure；pass Provider handler responses through unchanged.
- [ ] 3.8 Add Service tests for Workspace Builder selection、unavailable deployment Builder、unknown route、unavailable handler、Provider response passthrough and adapter cleanup.

## 4. Public HTTP callback

- [ ] 4.1 Add the dedicated `POST /callbacks/human-input/v2/im/<webhook_id>` blueprint without Console session、CSRF、Workspace or Account decorators，and register it only when deployment transport mode is `WEBHOOK`.
- [ ] 4.2 In the Flask handler，capture UTC receive time，validate `webhook_id` and read the exact body through `WEBHOOK_REQUEST_BODY_MAX_SIZE`；do not read deployment transport mode in the handler.
- [ ] 4.3 Populate `WebhookRequest.headers` with `tuple(request.headers.items())` and map `WebhookResponse` to Flask without rewriting status or body.
- [ ] 4.4 Add Flask tests proving the route is absent in `STREAM` mode and registered in `WEBHOOK` mode，then cover malformed route `404`、oversized body `413`、exact body/header mapping and Provider response passthrough.

## 5. Verification

- [ ] 5.1 Add one production-composition test proving that a real Provider handler receives the Channel-bound sink and that its `WebhookResponse` passes through unchanged；rely on existing Provider and inbox suites for challenge，authentication，ACK and persistence-failure semantics.
- [ ] 5.2 Verify ingress diagnostics contain no credential plaintext or ciphertext；reuse existing HTTP request、status and duration observability.
- [ ] 5.3 Run focused inbox and ingress tests、formatting、lint、type checks and `openspec validate add-im-provider-webhook-ingress --strict`.
