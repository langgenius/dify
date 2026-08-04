## Why

Channel Management now persists provider-independent tenant channel configuration, while Human Input v2 already models resolved approvers, delivery endpoints and delivery attempts. The missing path is an actual v2 producer that turns committed task facts into fully rendered notifications and drives a tenant-aware provider runtime. Without that integration, the new channel configuration cannot participate in Human Input v2 delivery.

Human Input v1 must remain unchanged. The new path is version-specific: v2 selects its channel and renders the Email before dispatch; Delivery Runtime captures the selected channel's current tenant configuration snapshot only when the worker is ready to send.

## What Changes

- Promote channel kind, provider and reference into credential-free shared identity values used by both Control Plane and Delivery Runtime.
- Add immutable rendered-Email runtime contracts, safe outcomes and a two-phase prepare/send boundary.
- Add send-time tenant configuration snapshot resolution for a preselected Email channel.
- Add a concrete request-scoped Resend adapter with explicit deadlines, stable idempotency, bounded retries and sanitized outcomes.
- Implement the Human Input v2 notification producer in the authoritative v2 task/form creation path.
- Generate endpoint access capabilities during v2 creation, persist only their hashes and render each Email while the plaintext capability and runtime render context are still available.
- Persist one initial queued attempt per rendered v2 Email endpoint with a protected rendered-request envelope, then publish attempt IDs to a v2-only Celery consumer on a dedicated `human_input_delivery` queue.
- Have the v2 worker claim the attempt, reveal the rendered request, capture and bind the current configuration snapshot, call Delivery Runtime outside database work and record a safe outcome.
- Keep duplicate publication, worker retry and provider retry on the same attempt, payload and idempotency identity.
- Leave Human Input v1 services, tasks, rendering, feature gates and `extensions.ext_mail.mail` routing unchanged.
- Keep IM provider delivery, Channel Management save/test connectivity, generic delivery-event query APIs and frontend delivery status outside this change.

## Capabilities

### New Capabilities

- `human-input-notification-delivery-runtime`: Defines delivery of an already-rendered Email through a preselected channel and a send-time tenant configuration snapshot.
- `human-input-resend-delivery-connectivity`: Defines concrete Resend send behavior, idempotency, retry classification, deadlines and safe receipts.
- `human-input-v2-notification-producer-integration`: Defines actual v2 materialization, protected queueing, worker dispatch and outcome recording without changing v1.

### Modified Capabilities

- `human-input-v2-form-core`: Refines initial notification-attempt creation, protected rendered-request facts and controlled attempt transitions while preserving form lifecycle independence.

## Impact

- Shared Human Input channel identity values under `api/core/human_input_v2/`
- New delivery-runtime contracts under `api/core/`
- Human Input v2 form/task creation orchestration
- `api/core/human_input_v2/approval/`
- `api/repositories/human_input_v2/form/`
- New v2 producer, runtime composition and Resend adapter under `api/services/`
- A new v2-only delivery task under `api/tasks/`, routed to the dedicated `human_input_delivery` queue
- Default Community/Cloud worker queue lists and deployment documentation updated to consume `human_input_delivery`
- Version-aware notification dispatch in workflow application composition
- Focused domain, repository, producer, worker, runtime and adapter tests
- No ORM table/column or Alembic migration
- No behavioral change to Human Input v1
