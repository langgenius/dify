---
title: Data Fixtures v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Fixtures v1.17 F-007 — difyctl CLI

> Validated against `schema/schemas.json` by `route/route.py`, which rejects an unknown entity, a missing required field or an undeclared one.

## Sets

`fixtures/fixtures_v1.17_F-007.json` is empty: this feature owns no relational entity [D: cli/src/].

## Provenance

I: these records were derived from the schema, not lifted from the repository's own fixtures — basis: the backend suite builds its data through factories and per-test setup rather than checked-in fixture files, so there was no existing set to reuse [D: api/tests/].

## Open questions

- OPEN: which scenario is each set *for*? A minimal valid record proves the shape and represents no case anyone cares about. A useful fixture set names its scenario, and that naming is not recoverable from code.
- OPEN: should these be seeded into a database anywhere, or do they exist only to validate the schema? Nothing currently consumes them but `route.py`.
