# 0007. Cross-Repo Workflow-Tool Parent Context Propagation

Date: 2026-04-23
Status: Accepted

## Context

The earlier Phoenix-local and Dify-only fixes established the downstream carrier chain for workflow-tool parent context:

- workflow tool runtime parameters
- `parent_trace_context`
- app generator `extras`
- persistence `TraceTask`
- Phoenix `resolved_parent_context`

Real production debugging showed that this chain still fails for nested workflows published as tools because the upstream runtime boundary does not expose enough context.

Two gaps were identified:

1. the workflow-tool runtime may receive `variable_pool=None` for older tool-node shapes
2. the current tool node execution identity is not exposed to the workflow runtime adapter at all

These are not Phoenix problems. They are runtime-boundary problems shared across `graphon` and Dify.

## Decision

Treat this work as a cross-repo feature split across `graphon` and Dify.

### Graphon responsibilities

`graphon` owns the runtime contract and tool-node execution boundary.

This change should make workflow tool runtime creation receive enough execution context to support:

- outer workflow run identity
- outer tool node execution identity
- compatibility for older tool-node versions that still need runtime context

### Dify responsibilities

Dify owns the workflow-layer adapter that translates graph runtime context into tool runtime parameters and then into tracing semantics.

This change should make Dify:

- consume the new Graphon runtime contract
- populate workflow-tool runtime parameters
- build `parent_trace_context`
- keep using the existing downstream carrier chain into Phoenix

## Target Outcome

For a top-level workflow that invokes nested workflows published as tools:

- nested workflow traces inherit the outer workflow session
- nested workflow traces can resolve the outer workflow as parent trace source
- nested workflow traces can resolve the outer tool node execution as parent span source

## Rationale

This split follows actual ownership boundaries:

- Graphon decides what the tool-node runtime adapter receives
- Dify decides how to map that runtime context into tracing metadata

Trying to solve both problems only in Dify leads to fragile fallbacks.
Trying to solve tracing semantics only in Graphon would leak application-specific policy downward.

## Consequences

This feature now requires coordinated but separated implementation:

- Graphon PR/commit for runtime boundary changes
- Dify PR/commit for adapter and tracing integration changes

Editable local dependency setup is acceptable during development, but must remain local-only until a released Graphon version is available.
