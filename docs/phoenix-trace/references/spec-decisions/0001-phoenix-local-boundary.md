# 0001. Transitional Phoenix-Local Boundary

Date: 2026-04-23
Status: Accepted for v1

## Context

The prototype implemented hierarchy logic inside the Phoenix-specific tracing adapter.

The longer-term architecture direction is still moving toward stronger upstream standardization, but upstream tracing refactors are currently being handled by other developers. To avoid conflict and keep the work bounded, the first reimplementation should not modify upstream tracing builders or contracts.

## Decision

For v1, all new implementation work should stay inside the Phoenix provider file.

This specifically means:

- do not modify `api/core/ops/ops_trace_manager.py`
- do not modify `api/core/ops/entities/trace_entity.py`
- do not modify `api/enterprise/telemetry/enterprise_trace.py`

The Phoenix implementation should consume upstream outputs as they already exist today.

## Consequences

### Positive

- avoids collision with ongoing upstream refactors
- keeps the implementation scope narrow
- allows reuse of already-available upstream context such as parent trace information

### Trade-Offs

- some semantics that would ideally live upstream remain temporarily duplicated or inferred in the Phoenix layer
- the Phoenix file continues to hold some business-facing hierarchy logic during the transition

## Notes For Future Migration

This boundary is transitional rather than final.

Implementation comments should make it explicit when a Phoenix-local rule exists only because the shared upstream tracing contract is not being changed in this phase.
