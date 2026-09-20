---
title: How to Read the Data Docs
status: draft
owner: TBD
updated: 2026-09-20
---

# How to Read the Data Docs

> Orient a human or agent in the data folder: which file is authoritative for shape, and what may never be duplicated elsewhere.

## Naming

<!-- `data-master-erd.md`, `data-erd_<version>_<F-nnn>.md`, `api-contract_<version>_<F-nnn>.md`, `data-fixtures_<version>_<F-nnn>.md`; machine artifacts under `schema/` and `fixtures/`. -->

TBD

## Single source of truth

<!-- Table: concern, authoritative file, who may only reference it. Entity shape lives in `schema/schemas.json` and nowhere else; ERDs draw it, OpenAPI/AsyncAPI $ref it, fixtures instantiate it, feature architecture points at it. -->

TBD

## Contract

<!-- Every entity: one `$defs` entry, one master-ERD box, one owning component, one introducing feature. Every endpoint and event: one entry in the feature API contract and its spec file. Every fixture record: valid against `schemas.json`. -->

TBD

## What belongs here / what does not

<!-- Shapes, contracts and test data yes; business rules no (those are `ddd/`), rationale no (that is `ADRs/` and `architect/`). -->

TBD

## Consistency check

<!-- `python route/route.py --version <v> --id <F-nnn>` validates every fixture record against `schemas.json` and fails on an unknown entity, a missing required field or an undeclared field. -->

TBD

## Change policy

<!-- These files are specification. They change during a spec pass, never while a route is being implemented. -->

TBD
