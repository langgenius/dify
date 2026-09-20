---
title: ADR-0004 — Backend layering is enforced by import-linter, with a shrinking exception list
id: ADR-0004
features: [F-001, F-002, F-003, F-004, F-005, F-006, F-007]
kind: adr
status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered
updated: 2026-09-20
---

# ADR-0004 — Backend layering is enforced by import-linter, with a shrinking exception list

Status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered

## Context

`api/.importlinter` declares 31 contracts over 13 root packages [D: api/.importlinter:1]. One is a `layers` contract
fixing the order `controllers -> services -> core -> libs` [D: api/.importlinter:21]. The other 30 are `forbidden`
contracts, each pinning one narrow query or application service to the controller allowed to import it
[D: api/.importlinter:160].

The layers contract carries 93 exact exceptions under a stated rule:

> "Migration baseline: keep every exception exact. The default unmatched-import error makes this list shrink whenever
> a legacy dependency is removed." [D: api/.importlinter:26]

`unmatched_ignore_imports_alerting = error` makes a stale exception fail the build [D: api/.importlinter:28].

## Decision

Layering is a build-time contract rather than a review convention, and existing violations are grandfathered
individually rather than waived by pattern [D: api/.importlinter].

## Alternatives considered

OPEN: not recoverable — code retains no record of what was rejected.

## Consequences

- A new violation of the layer order fails CI; an old one is visible as a named line in a list that can only shrink.
- Extracting a per-use-case service and pinning it with a `forbidden` contract is the established way to harden a
  boundary — 30 such contracts exist and none carries an exception [D: api/.importlinter].

OPEN: what is the target state? The contracts record what has been pinned and never the destination. OPEN: is there a
schedule or owner for draining the 93 exceptions?
