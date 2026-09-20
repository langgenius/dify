---
title: Data Fixtures v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Fixtures v1.17 F-002 — Workflow Engine and Authoring

> Validated against `schema/schemas.json` by `route/route.py`, which rejects an unknown entity, a missing required field or an undeclared one.

## Sets

`fixtures/fixtures_v1.17_F-002.json` holds one minimal valid record for each of 5 entities:

`workflows`, `workflow_runs`, `workflow_node_executions`, `workflow_draft_variables`, `workflow_pauses`

Each record carries required fields only, with fixed literal IDs and timestamps — no randomness and no real data.

## Provenance

I: these records were derived from the schema, not lifted from the repository's own fixtures — basis: the backend suite builds its data through factories and per-test setup rather than checked-in fixture files, so there was no existing set to reuse [D: api/tests/].

## Open questions

- OPEN: which scenario is each set *for*? A minimal valid record proves the shape and represents no case anyone cares about. A useful fixture set names its scenario, and that naming is not recoverable from code.
- OPEN: should these be seeded into a database anywhere, or do they exist only to validate the schema? Nothing currently consumes them but `route.py`.
- OPEN: several required fields are enum-typed and take the first declared value here. Is the first value the sensible default, or merely first?
