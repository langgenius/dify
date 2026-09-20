---
title: Data Model v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# Data Model v1.17 F-007 — difyctl CLI

> This feature owns no database entity. Its persistent state is local files on the operator's machine.

## Scope

Zero rows in `schemas.json`. The CLI is a client: every entity it displays is fetched over HTTP and owned by another feature [D: cli/src/api/].

It does persist local state:

| Store | Contents | Source |
| --- | --- | --- |
| `hosts.yml` | host entries and credentials | `cli/src/auth/` |
| `config.yml` | user configuration | `cli/src/config/` |
| app-info cache | cached app metadata | `cli/src/cache/` |

[D: cli/ARD.md]

OPEN: where on disk do these files live per platform, and what file permissions are they created with? `hosts.yml` holds credentials, so the answer is a security property, and the layout document does not state it.

## Feature ERD

Not applicable — no relational entities. `schema/erd_v1.17_F-007.puml` is an empty stub, deliberately.

## Field definitions

None in `schemas.json`. Response shapes the CLI consumes are defined by `packages/contracts/generated/api/openapi/types.gen.ts` [D: packages/contracts/generated/api/openapi/].

## New and changed entities

None.

## Migrations

None. Local state files are read and written directly [D: cli/src/config/].

OPEN: what happens when an older `difyctl` reads a `config.yml` written by a newer one? No version field and no migration path is visible in the config module.

## Traceability

Stories in `PRDs/prd_v1.17_F-007-difyctl-cli.md`.

OPEN: credentials in `hosts.yml` — are they stored in plaintext, and is that intentional on every platform?
