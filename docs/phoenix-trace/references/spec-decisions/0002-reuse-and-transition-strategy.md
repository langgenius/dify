# 0002. Reuse and Transition Strategy

Date: 2026-04-23
Status: Accepted for v1

## Context

The codebase already contains some upstream-standardized tracing semantics, especially around cross-workflow parent context propagation. Reimplementing those semantics again in Phoenix would increase divergence and make future migration harder.

At the same time, workflow-internal hierarchy is not yet fully upstreamed and still needs a Phoenix-local implementation in v1.

## Decision

The reuse rule for v1 is:

- upstream semantics first
- Phoenix fills gaps only when necessary

This means:

- if upstream already expresses a stable semantic, Phoenix should trust and reuse it
- if upstream does not yet express enough information for Phoenix behavior, Phoenix may apply a local fallback
- Phoenix should not redefine stable business semantics that already exist upstream

## What Counts As Upstream-First

For v1, Phoenix should preferentially reuse:

- trace identity and trace correlation outputs
- cross-workflow parent trace context
- upstream-expressed session semantics when available
- existing workflow and trace metadata

## What Remains Phoenix-Local In V1

Phoenix may still locally implement:

- workflow-internal hierarchy reconstruction
- node-parent rule execution
- Phoenix-specific span naming
- Phoenix UI-oriented metadata polish

## Notes For Future Migration

Much of the Phoenix-local hierarchy and session fallback logic is transitional.

Code comments should explicitly mark these areas as future upstream-migration candidates.
