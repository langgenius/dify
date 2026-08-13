# Resource Boundary Change Guide

- Resolve the tenant-scoped parent at the request boundary, then pass the validated model, owner reference, and actor downstream.
- Put the complete owner tuple in the database query; do not load by a bare ID and check ownership afterward.
- Treat missing and foreign-owned resources alike as `404` before locks, rate limits, tasks, plugin calls, network calls, or writes.
- Reuse existing owner resolvers and trusted objects instead of adding parallel helpers or refetching the same resource.
- Pass tenant, actor, and session explicitly; authenticated code must not depend on ambient account or tenant fallbacks.
- Raise typed domain errors in services and translate them to HTTP errors in controllers; reserve `ValueError` for invalid values or state.
- Let RBAC own authorization when enabled, and run legacy dataset permission checks only when RBAC is disabled.
- Preserve successful HTTP responses and shared runtime contracts, especially Celery task names and argument shapes during rolling upgrades.
- Keep runtime validation and OpenAPI schemas aligned, then regenerate Markdown and TypeScript contracts after schema changes.
- Prove the boundary with a foreign-owner decoy and assert that rejected requests trigger no downstream side effects.
