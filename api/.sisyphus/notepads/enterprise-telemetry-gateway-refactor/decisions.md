# Decisions

## [2026-02-06T02:58:22Z] Session Start: ses_3cfc17c5fffeBUMFsRxeFEXuNw

Architectural decisions from planning phase:
- Gateway is before-queue, not after-queue
- TelemetryFacade fully replaced (deleted), not kept as alias
- Two transport paths: trace → TraceQueueManager; metric/log → new enterprise Celery queue
- Idempotency via Redis TTL (telemetry:dedup:{tenant_id}:{event_id}, 1h TTL)
- Feature flag ENTERPRISE_TELEMETRY_GATEWAY_ENABLED for rollout

