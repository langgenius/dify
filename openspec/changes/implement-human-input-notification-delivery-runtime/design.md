## Context

The completed Channel Management core and Console API are Control Plane only. Human Input v2 already has:

- resolved approvers and frozen Email/IM/Web/Console endpoints;
- endpoint access-token hashes;
- a `DeliveryAttempt` model with `QUEUED`, `SENDING`, `SENT` and `FAILED` states;
- aggregate-oriented form persistence.

It does not yet have a task/form creation application path that produces provider-ready notifications, a durable rendered-request fact, a worker lifecycle or a concrete Resend sender.

The v2 node DSL stores `recipients_spec`, `message_template` and debug channels. Its message body deliberately does not require the v1 `{{#url#}}` placeholder, so the v2 producer must add the standard form action/link as application-owned Email presentation rather than inherit v1 template behavior.

The existing v1 path is separate. It loads legacy form/delivery rows and sends through `extensions.ext_mail.mail`; this change must not route those rows or tasks through the new runtime.

## Goals / Non-Goals

**Goals:**

- Implement a real Human Input v2 producer-to-provider path.
- Keep channel selection and Email rendering in v2 orchestration, before Delivery Runtime.
- Capture tenant provider configuration only when a worker is ready to send.
- Persist enough protected rendered state to recover queued work without rerendering or retaining a plaintext endpoint token.
- Implement real Resend delivery for Community and Cloud.
- Reuse one logical attempt, payload and idempotency identity across duplicate tasks and retries.
- Keep provider I/O outside database transactions and ORM lifetimes.
- Record credential-free v2 delivery outcomes without changing form lifecycle.
- Isolate tenant-configured HITL delivery concurrency, retry pressure and provider latency from transactional System Email and legacy v1 mail traffic.
- Preserve Human Input v1 behavior exactly.

**Non-Goals:**

- Make Delivery Runtime read forms, endpoints, node executions, workflow revisions or templates.
- Make a delivery worker rerender a v2 message or reconstruct an endpoint token from its hash.
- Modify Human Input v1 services, Celery entrypoints, rendering, feature gates, queue behavior or provider selection.
- Implement IM provider delivery, callbacks or credentials.
- Implement Channel Management save/test connectivity.
- Implement Enterprise deployment-wide Email provider resolution.
- Add a generic version-neutral delivery-event table/query API or frontend status UI.
- Add SMTP, SendGrid or another Email provider.
- Split the first Email implementation into provider-specific queues; the dedicated queue remains channel-runtime scoped.

## Decisions

### 1. Runtime accepts only a complete rendered Email

`RenderedEmailDeliveryRequest` represents one logical provider delivery:

- trusted `workspace_id`;
- preselected Email `ChannelRef`;
- stable `delivery_id`;
- one normalized recipient;
- rendered subject;
- rendered HTML and optional text body;
- stable provider-safe idempotency key;
- credential-free correlation metadata.

It contains no form, endpoint, workflow, node, template or ORM record. Runtime validates the request but never rerenders it.

### 2. Channel selection precedes Runtime

Upstream v2 planning selects a complete `ChannelRef`, including kind and provider. `ChannelKind`, `ChannelProvider` and `ChannelRef` move from management contracts into a credential-free shared channel-identity module with compatibility exports.

The first production v2 Email plan selects `ChannelRef(email, resend)`. Runtime never ranks configurations, changes that reference or falls back to another channel. A rendered Email cannot be converted into IM.

### 3. Configuration snapshot is captured at send time

`TenantEmailConfigurationSnapshotResolver` is keyed by trusted workspace plus the preselected Email channel. It loads the current matching configuration, verifies the provider, reveals the API key and returns one immutable `ResolvedEmailChannelSnapshot` containing:

- safe configuration ID and `updated_at` identity;
- provider;
- sender name/address;
- ephemeral credential with a secret-safe representation.

Configuration changes between task creation and first send are therefore visible. Once a snapshot is captured for one logical attempt, every retry must use the same safe snapshot identity. If the current configuration no longer matches that identity, retry fails as `provider_configuration_changed` rather than switching accounts.

### 4. Runtime exposes prepare and send phases

The runtime boundary is split deliberately:

1. `prepare(request, expected_snapshot=None)` resolves and validates one configuration snapshot and returns `PreparedRenderedEmailDelivery`.
2. `send(prepared)` performs provider I/O and returns `DeliveryOutcome`.

The v2 worker uses the gap between these calls to persist the safe configuration snapshot identity and payload fingerprint before provider I/O. This makes crash recovery deterministic without persisting credentials.

Both phases remain runtime operations. The producer cannot supply configuration settings, and `send` accepts only a prepared value created by the runtime.

### 5. V2 task creation owns token issuance and Email rendering

The authoritative Human Input v2 task/form creation application service owns:

1. recipient resolution and endpoint planning;
2. channel selection;
3. opaque endpoint access-token issuance;
4. form URL construction;
5. message-template and workflow-variable rendering;
6. standard v2 Email layout and form CTA rendering;
7. creation of one rendered request per Email endpoint.

Only the token hash is persisted on the endpoint. Plaintext capability material exists only while creating the form URL and rendered Email, is `repr=False`, and is discarded after the protected request is produced.

The v2 layout always provides the standard form action/link. `message_template.body` is user-authored content and does not need a v1 `{{#url#}}` token. Template or variable failure isolates the affected endpoint before provider configuration is read.

### 6. Initial attempts and protected rendered requests are durable producer facts

One initial `QUEUED` attempt is created for each rendered Email endpoint. Form, grants, endpoints, endpoint token hashes, attempts and their protected rendered requests are committed atomically.

The existing attempt JSON storage is refined into a strict `DeliveryAttemptData` model containing:

- protected rendered-request envelope;
- selected channel reference;
- payload fingerprint;
- provider-safe idempotency identity;
- optional safe configuration snapshot identity;
- bounded safe outcome diagnostics.

The physical JSON column is reused, so no schema migration is required. Existing terminal diagnostics remain readable through a legacy safe variant. A historical queued attempt without a protected request fails as `delivery_payload_unavailable`; it is never rerendered from current workflow state.

The rendered request is protected with a workspace-scoped application port before persistence. Recipient, subject, body and form URL must not appear as plaintext in database JSON, Celery arguments, logs or object representations.

### 7. Queued attempts drive a v2-only publisher and dedicated worker queue

A bounded publisher reads due v2 Email attempts and enqueues only `attempt_id` on the dedicated `human_input_delivery` queue. Celery is a wake-up mechanism; the durable source is the attempt row and its protected request.

The queue is separate from `mail` because tenant-configured provider calls have independent rate limits, retry pressure, latency and failure modes. Saturating Resend delivery must not delay password reset, invitation or other System Email tasks, and those transactional tasks must not starve HITL approvals.

`human_input_delivery` is added to the default Community and Cloud worker queue lists. Deployment examples and environment-variable documentation must also include it so installations using explicit `CELERY_QUEUES` or `CELERY_WORKER_QUEUES` do not silently leave v2 attempts unconsumed. A deployment may run a dedicated worker process for this queue or include it in a shared worker, but v2 tasks are always routed to this queue.

The v2 worker:

1. loads and claims the complete workspace/form/endpoint-owned attempt;
2. reveals the protected rendered request;
3. calls `runtime.prepare`;
4. binds the safe configuration snapshot identity and payload fingerprint to the attempt;
5. releases database resources;
6. calls `runtime.send`;
7. completes or requeues the attempt through compare-and-swap.

Duplicate task publication is safe because only one current claim wins. A publisher failure leaves the queued row eligible for the next scan.

### 8. Attempt transitions are controlled within one logical invocation

One attempt row represents one logical provider invocation:

```text
QUEUED -> SENDING -> SENT
                  -> FAILED
        <- SENDING
```

`SENDING -> QUEUED` is permitted only for a bounded retry of the same protected request, idempotency key, payload fingerprint and configuration snapshot identity. It does not increment `attempt_number`.

A stale `SENDING` claim may be recovered with compare-and-swap and the same identities. A new attempt number requires an explicit redelivery decision after the previous attempt is terminal; automatic provider retry does not create another row.

Provider I/O always occurs after claim/snapshot transactions commit.

### 9. Resend retry stays inside its idempotency horizon

Every Resend request includes a stable key derived from the delivery-attempt identity. Retryable failures include transport timeouts, connection failures, `5xx`, `rate_limit_exceeded` and `concurrent_idempotent_requests`.

The adapter performs short bounded retries with the exact prepared delivery. Worker requeue and stale recovery are also bounded so every automatic resend remains inside Resend's documented idempotency retention horizon. Work recovered after that horizon becomes `delivery_outcome_unknown` and is not sent automatically.

### 10. Outcomes are safe and form-lifecycle independent

Runtime and attempt outcomes contain only stable status/failure codes, safe retry guidance, safe configuration identity and provider message ID. Raw provider bodies, headers, exception strings, credentials and rendered content are prohibited.

Notification failure never submits, expires, times out or otherwise changes the Human Input form. Event-log/query APIs remain a separate capability.

### 11. V2 integration is real and version-specific

The v2 form/task creation composition must call the producer and commit initial attempts; it is not sufficient to expose an unused service.

When the workflow application observes a v2 Human Input notification-ready fact, it triggers the v2 due-attempt publisher. The existing v1 `HumanInputRequired` branch and both legacy delivery tasks remain unchanged. Version dispatch may add a new v2 branch, but must not reinterpret a v1 form ID as a v2 attempt or invoke the v2 producer for v1.

### 12. IM remains an independent runtime follow-up

V2 recipient resolution may still create IM endpoints, but this producer change creates rendered requests and queued attempts only for supported Email delivery. IM endpoints cannot block Email production and are not converted into fake Email requests or terminal IM attempts.

A later IM runtime must define its own rendered payload, callback/authentication semantics and provider adapters.

## Risks / Trade-offs

- [Worker cannot reconstruct a hash-only form token] -> Render while plaintext capability is available and persist only a protected rendered request plus endpoint hash.
- [Protected request storage is mistaken for provider diagnostics] -> Introduce a strict `DeliveryAttemptData` model and compatibility mapping over the existing JSON column.
- [Duplicate Celery tasks duplicate Email] -> Claim by CAS and reuse one attempt-scoped Resend idempotency key.
- [Worker crashes after provider acceptance] -> Recover the same attempt with the same payload, snapshot and key within the provider horizon.
- [Configuration rotates during retry] -> Persist safe snapshot identity before send and reject mismatched retry.
- [Provider I/O holds locks] -> Split prepare/bind/send and close database work before `send`.
- [V2 rendering drifts toward v1 placeholder semantics] -> Give v2 a standard CTA and test that `message_template.body` does not require `{{#url#}}`.
- [Runtime lands but no producer uses it] -> Require wiring in the authoritative v2 creation and workflow notification composition.
- [Dedicated queue is not consumed after upgrade] -> Add it to default worker queue lists, deployment examples and explicit-queue documentation with routing tests.
- [V1 behavior changes accidentally] -> Keep its tasks/providers untouched and run focused v1 regressions.
- [Secret material leaks through durable work] -> Protect rendered requests and audit database, queue arguments, logs, exceptions and representations.

## Migration Plan

No ORM table/column or data migration is required.

1. Extract shared channel identity and add rendered request, prepared delivery, snapshot and outcome contracts.
2. Refine attempt JSON mapping into strict protected request/snapshot/outcome data with legacy terminal compatibility.
3. Add attempt reservation, claim, snapshot binding, requeue, stale recovery and CAS completion operations.
4. Implement send-time configuration snapshot resolution and the Resend adapter.
5. Implement v2 token issuance, rendering, protected request creation and atomic initial-attempt persistence.
6. Add the v2 due-attempt publisher and worker on the dedicated `human_input_delivery` queue and update worker queue configuration.
7. Wire the authoritative v2 form/task creation and workflow notification composition.
8. Verify existing v1 tasks and routing remain unchanged.
9. Roll back by disabling the v2 producer/publisher composition. Existing attempts remain diagnostic facts; protected payloads can be discarded after terminal retention policy permits.

## Open Questions

None.
