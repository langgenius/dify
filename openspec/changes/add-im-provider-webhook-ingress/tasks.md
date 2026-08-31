## 1. Ingress prerequisites and request bounds

- [ ] 1.1 Require completed Channel Management contracts for `IMChannel`、`WebhookId`、transport mode、Provider capability and Human Input callback URL generation；do not duplicate their implementation here.
- [ ] 1.2 Add `HUMAN_INPUT_IM_WEBHOOK_MAX_BODY_BYTES` configuration、range validation and matching service-specific environment sample.

## 2. Migrate durable inbox routing to Channel identity

- [ ] 2.1 Update `im-message-inbox` contracts、ORM and unpublished migration so local routing uses non-null `channel_id: IMChannelId` instead of `integration_id`，with no compatibility alias、dual read/write or backfill.
- [ ] 2.2 Update `IMMessageInboxSink`、`IMMessageInboxRepository.insert_or_resolve()`、mappers、`IMInboxDelivery`、worker consumers and safe logs to use Channel ID while preserving Provider/tenant validation and immutable event facts.
- [ ] 2.3 Preserve deduplication key `(provider, provider_tenant_id, provider_event_id)` without Channel ID；add replacement/redelivery tests proving duplicates keep the first record's immutable Channel routing.
- [ ] 2.4 Run existing SQLite inbox persistence/sink/worker suites and PostgreSQL concurrency contracts after the routing rename.

## 3. Channel reverse lookup and ingress service

- [ ] 3.1 Define immutable `IMWebhookChannelRoute(channel: IMChannel, scope: WorkspaceScope | DeploymentScope)` and `IMWebhookChannelRepository.load_by_webhook_id(WebhookId)` with distinct not-found and safe lookup-failure outcomes；do not expose raw `owner_key` or ORM records.
- [ ] 3.2 Implement reverse lookup against globally unique `HumanInputIMChannel.webhook_id`，map owner key internally to validated scope and test current route、malformed owner、rotation、replacement、delete and database failure behavior.
- [ ] 3.3 Implement `IMWebhookIngressService.handle(webhook_id, request)`：reject `STREAM` before lookup，load current Channel route，check Provider capability，select Workspace or injected Deployment cipher，open `IMEncryptedCredentials` exactly once and construct one request-scoped adapter through `build_im_provider_adapter()`.
- [ ] 3.4 Construct one Channel-bound `IMMessageInboxSink` per admitted callback，call `create_webhook_handler()`、invoke returned handler and close root adapter on every post-construction path；do not retain adapter、handler or credentials across requests.
- [ ] 3.5 Map malformed/unknown route、`STREAM`、unsupported Provider and unavailable credential-bound handler to one `404`；map lookup、scope、cipher、credential、adapter and unclassified internal failures to payload-free `503`；pass Provider handler responses through unchanged.
- [ ] 3.6 Add Service tests for Workspace cipher、missing/injected Deployment cipher、envelope version/decrypt/JSON/Pydantic/provider mismatch、adapter construction、handler unavailable、challenge、authentication failure、durable ACK、duplicate、inbox failure and response passthrough.
- [ ] 3.7 Add configuration-race tests proving post-rotation lookup uses new envelope，post-replacement/delete old route returns `404`，and a pre-commit Channel snapshot may finish without holding Channel transaction during Provider or inbox work.
- [ ] 3.8 Confirm this change does not modify Contact Sync or introduce an Integration-to-adapter compatibility factory；future Contact Sync migration may reuse Channel composition after it owns `IMChannelId`.

## 4. Public HTTP callback boundary

- [ ] 4.1 Add dedicated `controllers.im_provider_webhook` blueprint and `POST /callbacks/human-input/v2/im/<webhook_id>` without Console session、CSRF、Workspace/Account decorators or application CORS policy.
- [ ] 4.2 Capture trusted UTC receive time at controller entry，validate route identity，read exact body through bounded reader and return `413` before repository、adapter or inbox calls when oversized.
- [ ] 4.3 Construct adapters-package `WebhookRequest` from uppercase method、`tuple(request.headers.items())`、exact body bytes and receive time without extra header parsing.
- [ ] 4.4 Map `WebhookResponse` status、ordered headers and exact body to Flask `Response`，allow Flask to recalculate `Content-Length`，then register blueprint and request-scoped ingress composition.
- [ ] 4.5 Add Flask request tests for malformed/unknown route `404` parity、exact body、receive-time ordering、oversize `413`、ignored cookies/CSRF、no CORS preflight fallback and byte-preserving challenge/ACK response adaptation.

## 5. Framework-neutral request mapping

- [ ] 5.1 Update `im-provider-events` contract tests so `WebhookRequest.headers` accepts Flask name/value pairs without framework objects.
- [ ] 5.2 Add real Flask request tests asserting `WebhookRequest.headers == tuple(request.headers.items())` and preserving exact signature body bytes.

## 6. Observability、verification and rollout

- [ ] 6.1 Add low-cardinality ingress request、route miss、oversize、handler response class、internal unavailable and duration metrics；after each successful Channel lookup，log `im_webhook_channel_resolved` with Provider and Channel ID before capability、cipher or credential work.
- [ ] 6.2 Add observability tests proving logs、metrics、traces and exceptions contain no payload、headers、tenant ID、credential plaintext/ciphertext or complete `webhook_id`，and metric dimensions contain no high-cardinality identity.
- [ ] 6.3 Add Provider adapter tests for credential-bound handler availability and verify callers reuse `IMProvider.supports_webhook()` without duplicating Provider allowlists.
- [ ] 6.4 Add ingress-to-inbox integration coverage for challenge without inbox write、authentication rejection、durable success ACK、real-ID duplicate ACK、persistence failure and post-commit broker wakeup failure.
- [ ] 6.5 Run focused backend unit tests、inbox persistence tests、controller tests、formatting、lint、type checks and `openspec validate add-im-provider-webhook-ingress --strict`.
- [ ] 6.6 Keep transport mode `STREAM` for initial deployment verification，then select `WEBHOOK` only after callback route、Workspace cipher and inbox acceptance pass；verify deployment-owned callback returns safe `503` without injected deployment cipher and succeeds only after injection.
