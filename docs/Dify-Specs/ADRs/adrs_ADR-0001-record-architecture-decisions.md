---
title: ADR-0001 — Record Architecture Decisions
id: ADR-0001
kind: adr
features: [F-001, F-002, F-003, F-004, F-005, F-006, F-007]
status: accepted
owner: TBD
updated: 2026-09-20
---

# ADR-0001 — Record Architecture Decisions

Status: accepted

## Context

This documentation hub was reconstructed from the Dify codebase on 2026-09-20. The reconstruction found several
architectural decisions that are unmistakable in the code and unexplained anywhere in it:

- referential integrity enforced in application code rather than by the database — 8 `ForeignKey()` declarations
  against 357 `*_id` columns [D: api/models/]
- an API contract that is generated and imported as a package rather than written by hand
  [D: packages/contracts/generated/]
- import layering enforced in CI, with an exception list the configuration states should shrink
  [D: api/.importlinter:26]
- 51 provider integrations shipped as separate installable packages [D: api/providers/]

Each of these shapes everything built on top of it, and a contributor meeting one for the first time has no way to
learn why it is that way.

## Decision

Architecture decisions are recorded as numbered ADRs in `docs/Dify-Specs/ADRs/`.

Decisions reconstructed from code carry the status line
`accepted (reconstructed from code, <date>) — rationale not recovered`, state their Context as facts with citations,
and leave `Alternatives considered` as an explicit `OPEN:`.

## Alternatives considered

Writing no record, and leaving the reasoning in commit messages and reviewers' memory. Rejected here because this
hub already demonstrates the cost: four significant decisions were recovered as behaviour and none as reasoning.

## Consequences

- A reconstructed ADR is honest about what it does not know. It never invents an alternatives table, because doing so
  forecloses the discussion the record exists to start.
- ADR-0002 through ADR-0005 are reconstructions. Someone who knows the history can replace an `OPEN:` with the real
  rationale, and that edit is the point of the document.
- New decisions taken from here on should be recorded before the code lands, at which point the status line is plain
  `accepted` and `Alternatives considered` is a real section.

OPEN: who approves an ADR for this project, and where is that decision currently taken?
