---
title: Tasks v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# Tasks v1.17 F-007 — difyctl CLI

> **As-built inventory, not a plan.** Every task below is already shipped; each points at the artifact that exists. `done-when` is written as the check that *would* prove it, because that is what the status column has to cash — and none of it has been cashed here.

## Tasks

| ID | Task | Artifact | Done-when |
| --- | --- | --- | --- |
| F-007-T001 | Command `difyctl auth devices list` | `cli/src/commands/auth/devices/list/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T002 | Command `difyctl auth devices revoke` | `cli/src/commands/auth/devices/revoke/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T003 | Command `difyctl auth list` | `cli/src/commands/auth/list/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T004 | Command `difyctl auth login` | `cli/src/commands/auth/login/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T005 | Command `difyctl auth logout` | `cli/src/commands/auth/logout/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T006 | Command `difyctl auth whoami` | `cli/src/commands/auth/whoami/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T007 | Command `difyctl config get` | `cli/src/commands/config/get/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T008 | Command `difyctl config path` | `cli/src/commands/config/path/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T009 | Command `difyctl config set` | `cli/src/commands/config/set/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T010 | Command `difyctl config unset` | `cli/src/commands/config/unset/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T011 | Command `difyctl config view` | `cli/src/commands/config/view/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T012 | Command `difyctl create member` | `cli/src/commands/create/member/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T013 | Command `difyctl delete member` | `cli/src/commands/delete/member/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T014 | Command `difyctl describe app` | `cli/src/commands/describe/app/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T015 | Command `difyctl env list` | `cli/src/commands/env/list/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T016 | Command `difyctl export studio-app` | `cli/src/commands/export/studio-app/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T017 | Command `difyctl get app` | `cli/src/commands/get/app/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T018 | Command `difyctl get member` | `cli/src/commands/get/member/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T019 | Command `difyctl get workspace` | `cli/src/commands/get/workspace/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T020 | Command `difyctl import studio-app` | `cli/src/commands/import/studio-app/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T021 | Command `difyctl resume app` | `cli/src/commands/resume/app/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T022 | Command `difyctl run app` | `cli/src/commands/run/app/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T023 | Command `difyctl set member` | `cli/src/commands/set/member/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T024 | Command `difyctl skills install` | `cli/src/commands/skills/install/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T025 | Command `difyctl use account` | `cli/src/commands/use/account/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T026 | Command `difyctl use host` | `cli/src/commands/use/host/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T027 | Command `difyctl use workspace` | `cli/src/commands/use/workspace/index.ts` | `cd cli && pnpm test` passes the suite covering this command |
| F-007-T028 | Command `difyctl version` | `cli/src/commands/version/index.ts` | `cd cli && pnpm test` passes the suite covering this command |

28 tasks.

## Status

Every row is `todo` in the table above and must move `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`; the transition guard is the check [D: docs/Dify-Specs/status-model.md].

No row may read `done` without a command and its result in the note.

OPEN: this inventory is one task per module and one per entity. Is that the unit of work the team recognises, or should a task be a user-visible capability? The repository records commits, not tasks.

## Open questions

- OPEN: what was the original sequencing? A working tree preserves the result and not the order.
- OPEN: which of these were delivered together as one release? Tags would say; the repository has none [D: survey of `git tag`].
