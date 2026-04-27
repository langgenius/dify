# 0004. Canonical Root and Session Principles

Date: 2026-04-23
Status: Accepted for v1

## Context

Earlier prototype analysis strongly suggests that Phoenix session issues are tied not only to session propagation inconsistencies, but also to traces being emitted with orphan-root behavior instead of clean canonical roots.

At the same time, session semantics in Dify have already been reasoned through at the product level and should not be treated as Phoenix-only concepts.

## Decision

### Canonical Root Is A Hard Invariant

The top-level workflow or chatflow span must be emitted as a true root span with no fabricated parent context.

Only nested workflows may be explicitly attached to an outer tool span.

Phoenix-local hierarchy reconstruction must not assign a synthetic parent to the top-level root span.

### Session Semantics

For v1, the session rules are:

- top-level workflow: `session.id = workflow_run_id`
- top-level chatflow: `session.id = conversation_id`
- nested workflow: inherit the outer session identity

### Upstream-First Session Handling

Phoenix should prefer upstream-expressed session semantics whenever they are already available.

If upstream does not provide an explicit session field but existing metadata is sufficient, Phoenix may apply local fallback logic that follows the session rules above.

Phoenix should not invent a session model that conflicts with Dify business semantics.

## Notes For Future Migration

Session fallback logic and canonical-root safeguards are transitional candidates for eventual upstream standardization.

Implementation comments should make that migration target explicit where practical.
