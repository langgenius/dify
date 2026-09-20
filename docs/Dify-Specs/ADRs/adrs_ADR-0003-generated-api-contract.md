---
title: ADR-0003 — The API contract is generated, not hand-written
id: ADR-0003
features: [F-001, F-002, F-003, F-004, F-005, F-006, F-007]
kind: adr
status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered
updated: 2026-09-20
---

# ADR-0003 — The API contract is generated, not hand-written

Status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered

## Context

The backend declares response models inline with Flask-RESTX decorators [D: api/controllers/console/app/app.py:638].
Three generators turn those declarations into checked-in artefacts:

- `api/dev/generate_swagger_specs.py`, which serialises the Flask-RESTX OpenAPI documents without booting the backend
  [D: api/dev/generate_swagger_specs.py:1]
- `api/dev/generate_swagger_markdown_docs.py`, rendering `api/openapi/markdown/*.md` — 1.1 MB across four surfaces
  [D: api/openapi/markdown/]
- the `packages/contracts` generator, producing 180 TypeScript files of types, Zod schemas and oRPC clients
  [D: packages/contracts/generated/]

`make api-contract-lint` checks each handler's documented response against the schema it returns [D: Makefile:87].

## Decision

The contract is derived from the handlers and published as generated code; consumers import the generated package
rather than writing request code by hand [D: cli/src/api/apps.ts:5].

## Alternatives considered

OPEN: not recoverable — code retains no record of what was rejected.

## Consequences

- `packages/contracts` is a runtime dependency of `difyctl`, not documentation [D: cli/src/api/apps.ts:26].
- A handler's response shape and its published contract cannot drift silently while `api-contract-lint` passes.
- This documentation hub deliberately does not restate payload shapes; doing so would create a third source
  [D: docs/Dify-Specs/data/data-master-erd.md].

OPEN: is regeneration enforced in CI? `cli/src/commands/tree.generated.ts` states its own drift gate
[D: cli/src/commands/tree.generated.ts:2]; no equivalent statement was found for `packages/contracts`.
