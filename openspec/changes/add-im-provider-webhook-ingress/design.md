## Context

Channel Management owns `IMChannel`、stable `webhook_id` lifecycle、deployment transport mode、`IMProvider.supports_webhook()` and callback URL projection。Provider adapters own challenge handling、request authentication、payload decoding and Provider response construction through `IMWebhookHandler.handle(WebhookRequest) -> WebhookResponse`。

This change adds the missing HTTP ingress。Because ingress resolves `IMChannel` rather than the removed Integration model，it also changes the unpublished inbox routing field from `integration_id` to `channel_id: IMChannelId`。

## Goals / Non-Goals

**Goals:**

- Expose `POST /callbacks/human-input/v2/im/<webhook_id>` when deployment transport is `WEBHOOK`。
- Resolve the current Channel and its credential scope from `webhook_id`。
- Define one reusable `IMProviderBuilder` that constructs an `IMProviderAdapter` from an `IMChannel` through an already-bound credential cipher。
- Construct one credential-bound Provider handler for each callback through that Builder。
- Preserve exact request body bytes and Provider response facts。
- Bind inbox records and worker deliveries to the current `IMChannelId`。
- Require durable inbox acceptance before a Provider handler returns success for a business event。

**Non-Goals:**

- Do not change Channel、Webhook ID or credential envelope lifecycle。
- Do not change Provider authentication、challenge、payload decoding or ACK algorithms。
- Do not add handler caching、STREAM supervision、business-event consumption or inbox retention。
- Do not define deployment credential cipher provisioning、storage or rotation。
- Do not add an ingress-specific metrics abstraction or endpoint-specific Sentry、OpenTelemetry、request logging or Nginx policy。

## Decisions

### 1. The controller performs bounded HTTP adaptation

Add a dedicated callback blueprint with prefix `/callbacks/human-input/v2/im` and one `POST /<webhook_id>` route。Application composition registers this blueprint only when `dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE` is `WEBHOOK`。In `STREAM` mode Flask has no matching route and returns its normal `404`。The route has no Console session、CSRF、Workspace or Account decorator。Provider verification authenticates the request。

The controller：

1. captures the receive time；
2. validates the URL-safe `webhook_id` before querying persistence；
3. reads at most `dify_config.WEBHOOK_REQUEST_BODY_MAX_SIZE` plus one byte；
4. constructs `WebhookRequest` from the uppercase method、`tuple(request.headers.items())`、exact body bytes and receive time；
5. maps the returned status、ordered headers and body to a Flask `Response`。

An oversized body returns `413` before Channel lookup。The controller does not read deployment transport mode、parse Provider payloads or select credentials。

### 2. Reverse lookup returns a detached Channel route

`IMWebhookChannelRepository.find_by_webhook_id(webhook_id)` queries the current `HumanInputIMChannel` row by its globally unique `webhook_id`。It returns `None` when no row exists。Otherwise it returns an immutable `IMWebhookChannelRoute` containing the owner-free `IMChannel` and validated `credential_scope: WorkspaceScope | DeploymentScope`。

The repository parses persisted `owner_key` and closes its database transaction before returning。It does not decrypt credentials or perform Provider or inbox I/O。A missing row and a query or mapping failure remain distinct outcomes。

The returned route is a detached snapshot。A request may finish with the snapshot it loaded。A lookup started after Channel replacement or deletion does not resolve the old `webhook_id`。Downstream consumers continue to load current Channel and Binding state when authorizing business actions。

### 3. IMProviderBuilder owns credential materialization

`IMProviderBuilder` is a reusable application component constructed with one already-bound `BoundCredentialCipher`。Its public operation is `build(channel: IMChannel) -> IMProviderAdapter`。The operation calls `IMCredentialCodec.load(channel.provider, channel.encrypted_credentials)` and then `build_im_provider_adapter(credentials)`。It accepts neither `IMWebhookChannelRoute` nor `WorkspaceScope | DeploymentScope`，and it does not resolve owner identity or cipher lifecycle。

Each `build()` call returns a new adapter。The Builder does not cache the Channel，recovered credentials or adapter。The caller owns the returned adapter and must close it。Credential envelope validation and Provider-discriminator matching remain inside `IMCredentialCodec`。

### 4. The credential-bound handler is the runtime capability authority

`IMWebhookIngressService.handle(webhook_id, request)` loads the current route and resolves an owner-bound `IMProviderBuilder` from `route.credential_scope`。It calls `builder.build(route.channel)` exactly once for each admitted callback。Transport-mode policy belongs to blueprint registration and does not belong to the Service。

The Service calls `adapter.create_webhook_handler()` with a Channel-bound `IMMessageInboxSink`。A `None` handler returns the same `404` as an unknown route。Ingress does not separately call `IMProvider.supports_webhook()`; Channel Management may continue using that static capability when projecting `webhook_url`。

The adapter is request-scoped and is closed after handler invocation。The implementation does not cache adapters、handlers or recovered credentials。

Workspace routes select a Builder whose `TenantBoundCredentialCipher` is bound to the Tenant ID from `WorkspaceScope`。Deployment routes select a Builder using the deployment-bound cipher supplied by the independent deployment credential capability；if that capability is unavailable, ingress returns `503`。This change does not add a second cipher registration or provisioning mechanism。

### 5. The Service returns the Provider response unchanged

The Service passes an `IMMessageInboxSink` bound to `channel.id`、`channel.provider` and `channel.provider_tenant_id` to the Provider handler。It returns the handler's `WebhookResponse` without changing its status，headers or body。Provider adapters and the inbox own challenge，authentication，ACK and durable-acceptance semantics。

Malformed or unknown routes and unavailable handlers return an empty `404`。Body overflow returns an empty `413`。Route lookup、Builder resolution or `build()` failure、and handler construction failure return an empty `503`。Ingress does not enumerate internal failure classes in its public response。

### 6. Inbox routing uses Channel identity

`IMMessageInboxSink`、`IMMessageInboxRepository`、the inbox ORM and `IMInboxDelivery` use `channel_id: IMChannelId` instead of the removed Integration identity。The unpublished migration creates the non-null `channel_id` column without a compatibility alias、dual read/write or data backfill。

Provider event deduplication remains `(provider, provider_tenant_id, provider_event_id)`。It does not include Channel ID or ingress kind。Resolving a duplicate preserves the first record's Channel ID and authenticated event facts。

### 7. Ingress reuses existing observability infrastructure

Ingress may log `webhook_id`、Channel ID、Provider and a stable failure code。Ingress logs、traces and exceptions must not contain credential plaintext or credential ciphertext。`webhook_id` is an observable routing identifier rather than a credential。

Existing HTTP metrics and tracing remain responsible for request count、status and duration。This change does not introduce a parallel ingress metrics interface or duplicate callback-path filtering across infrastructure modules。

## Risks / Trade-offs

- [Every callback constructs an adapter] → Keep the first implementation request-scoped and add caching only after measured construction cost justifies it。
- [Deployment cipher may be unavailable on an existing installation] → Return `503` until the independent deployment credential capability is provisioned；do not add a webhook-specific cipher lifecycle。
- [A request can overlap Channel mutation] → Use the detached lookup snapshot and keep Provider I/O outside the Channel transaction。
- [`webhook_id` is publicly observable] → Treat it as routing information only；Provider authentication remains mandatory。

## Migration Plan

1. Add `IMProviderBuilder` over the existing credential codec and Provider adapter constructor。
2. Change the unpublished inbox routing field and contracts to `channel_id`。
3. Deploy the body bound、reverse lookup、Ingress Service and callback blueprint while transport remains `STREAM`；the blueprint remains unregistered。
4. Verify Provider challenge、authentication and durable inbox acceptance for Workspace-owned Channels。
5. Enable `WEBHOOK` after required credential ciphers are available。
