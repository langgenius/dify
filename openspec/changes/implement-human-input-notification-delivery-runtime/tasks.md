## 1. Define Shared Runtime Contracts

- [x] 1.1 Promote `ChannelKind`, `ChannelProvider` and `ChannelRef` into a credential-free shared channel-identity module with compatibility exports and unchanged Channel Management behavior.
- [x] 1.2 Add strict immutable `RenderedEmailDeliveryRequest`, `ResolvedEmailChannelSnapshot`, `PreparedRenderedEmailDelivery`, safe receipt, retry guidance, failure and outcome values.
- [x] 1.3 Add red-first tests for required workspace, selected channel, delivery, recipient, subject, body, idempotency and credential-safe representation invariants.
- [x] 1.4 Define `HumanInputRenderedEmailDeliveryRuntime.prepare()` and `.send()` so only Runtime can create a prepared value and callers cannot supply configuration settings.
- [x] 1.5 Implement a duplicate-safe `EmailProviderAdapterRegistry` keyed by Email provider type with fail-fast duplicate registration.
- [x] 1.6 Add payload fingerprint and provider-safe idempotency-key derivation from stable delivery-attempt identity.
- [x] 1.7 Add import-boundary tests proving runtime core imports no ORM, Flask, Celery, Channel Management command/view DTO or provider SDK modules.

## 2. Implement Send-Time Configuration Snapshot Resolution

- [x] 2.1 Add a Community/Cloud resolver that loads configuration matching trusted workspace plus preselected channel immediately before dispatch.
- [x] 2.2 Include safe configuration ID/`updated_at`, provider and sender settings in the immutable snapshot while keeping revealed credentials ephemeral and secret-safe.
- [x] 2.3 Add resolver tests for configured, missing, deleted, wrong-workspace, channel/provider mismatch, updated-after-planning and decryption-failure paths.
- [x] 2.4 Implement expected-snapshot verification so a retry cannot switch configuration or provider account.
- [x] 2.5 Prove the resolver never selects/substitutes a channel, consumes caller configuration metadata, calls the Channel Management facade or reads System Email configuration.
- [x] 2.6 Compose repository sessions so the snapshot is detached and the session is released before provider dispatch.

## 3. Implement Resend Delivery Connectivity

- [x] 3.1 Define an injectable narrow Resend client and deterministic fakes for acceptance, timeout, connection, rate limit, concurrent idempotency, `5xx`, terminal and malformed responses.
- [x] 3.2 Implement a request-scoped Resend client with fixed API origin, explicit request deadline and no mutable global SDK state.
- [x] 3.3 Implement the Resend adapter using prepared sender/credential settings, stable `Idempotency-Key`, payload fingerprint enforcement and a safe message-ID receipt.
- [x] 3.4 Implement retry classification for bounded `Retry-After`, transient transport/provider failures, quota exhaustion and idempotency conflicts.
- [x] 3.5 Implement bounded short retries that reuse the exact prepared snapshot, payload and idempotency key.
- [x] 3.6 Add tests proving separate attempts receive separate keys and all retries of one attempt reuse the exact key, snapshot and payload.
- [x] 3.7 Audit adapter results, logs, metrics, exceptions and fake representations for API key, authorization header, recipient payload and raw provider-response leakage.

## 4. Produce Durable Rendered Email From Human Input V2

- [x] 4.1 Add red-first v2 producer tests covering channel selection, endpoint token issuance, one Email request per endpoint, mixed Email/IM plans and endpoint-level failure isolation.
- [x] 4.2 Implement a secret-safe endpoint access-token issuer that returns plaintext capability only to creation-time rendering and persists only its SHA-256 hash.
- [x] 4.3 Implement v2 Email materialization from `message_template`, runtime variable values, form presentation facts and the generated v2 form URL.
- [x] 4.4 Add the standard v2 Email layout/CTA without requiring or interpreting the v1 `{{#url#}}` placeholder.
- [x] 4.5 Implement workspace-scoped protection/reveal ports for a strict rendered-request envelope and prove recipient, body and form capability are not plaintext at rest.
- [x] 4.6 Refine the existing attempt JSON mapping into strict protected request, selected channel, payload fingerprint, idempotency, safe snapshot and safe outcome data with legacy terminal compatibility.
- [x] 4.7 Create one initial `QUEUED` attempt for every supported Email endpoint and no Email attempt for IM, Web or Console endpoints.
- [x] 4.8 Extend form creation persistence to commit form, grants, endpoints, token hashes, initial attempts and protected rendered requests atomically without a schema migration.
- [x] 4.9 Add mapper, repository and query-count tests proving no plaintext token/rendered Email leaks and no ORM record escapes producer persistence.

## 5. Dispatch V2 Attempts Through The Runtime

- [x] 5.1 Add repository operations and red-first concurrency tests for idempotent initial scheduling, bounded due reads, claim, safe snapshot binding, requeue, stale recovery and CAS terminal completion.
- [x] 5.2 Add a bounded v2 due-attempt publisher that enqueues only attempt IDs on the dedicated `human_input_delivery` queue and safely tolerates duplicate publication.
- [x] 5.3 Add `human_input_delivery` to default Community/Cloud worker queue lists, deployment examples and explicit `CELERY_QUEUES`/`CELERY_WORKER_QUEUES` documentation with routing/configuration tests.
- [x] 5.4 Add a v2-only Celery task fixed to `human_input_delivery` whose arguments contain no recipient, rendered content, endpoint capability or provider credential.
- [x] 5.5 Implement the worker load/claim/reveal path with complete workspace/form/endpoint ownership checks and no current workflow/template lookup.
- [x] 5.6 Prepare the rendered delivery, persist its safe configuration snapshot identity and payload fingerprint, close database work, then call Runtime send.
- [x] 5.7 Map accepted, retryable and terminal outcomes to requeue or CAS completion while preserving one attempt number, payload and idempotency identity.
- [x] 5.8 Implement stale-sending recovery and stop automatic resend with `delivery_outcome_unknown` outside the configured provider idempotency horizon.
- [x] 5.9 Add worker tests for enqueue failure recovery, duplicate tasks, concurrent claims, process-loss recovery, configuration rotation, payload mismatch, partial endpoint failure and unchanged form lifecycle.
- [ ] 5.10 Wire the authoritative Human Input v2 form/task creation and workflow notification-ready path to the producer/publisher; prove the runtime is used end to end rather than merely composed.
- [x] 5.11 Keep IM endpoints isolated as unsupported follow-up work without blocking v2 Email attempts or creating fake IM outcomes.

## 6. Preserve V1 And Validate The Change

- [x] 6.1 Add focused regressions proving existing v1 services, `dispatch_human_input_form_delivery_task`, `dispatch_human_input_email_task`, feature gates, `extensions.ext_mail.mail` behavior and `mail` queue routing remain unchanged.
- [x] 6.2 Run focused domain, mapper, repository, producer, publisher, worker, runtime and adapter suites without live provider credentials.
- [x] 6.3 Run backend formatting, linting and type checking for every affected file.
- [x] 6.4 Audit database JSON, Celery arguments, request/outcome representations, structured logs, exception chains and metrics for credentials, endpoint tokens and rendered message content.
- [x] 6.5 Confirm provider I/O occurs outside repository sessions/transactions and configuration is resolved once then fixed for the logical attempt.
- [x] 6.6 Confirm no ORM schema migration, v1 integration, IM provider adapter, Channel Management connectivity, generic event-query API or frontend status UI entered the change, and verify `human_input_delivery` is the only new queue.
- [x] 6.7 Validate `implement-human-input-notification-delivery-runtime`, `human-input-v2-notification-producer-integration` and the modified `human-input-v2-form-core` capability with strict OpenSpec validation.
