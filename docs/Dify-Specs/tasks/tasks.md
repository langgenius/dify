---
title: Task Index — Dify v1.17
status: draft
owner: TBD
updated: 2026-09-20
---

# Task Index — Dify v1.17

> **Every task file in this hub is an as-built inventory, not a plan.** The work is shipped; these files record what
> exists and what check would prove it. No row reads `done` until a command and its result sit in the note.

## Task files

| Feature | Title | File | Tasks |
| --- | --- | --- | --- |
| F-001 | App Studio and Publishing | `tasks_v1.17_F-001.md` | 50 |
| F-002 | Workflow Engine and Authoring | `tasks_v1.17_F-002.md` | 59 |
| F-003 | Knowledge and RAG | `tasks_v1.17_F-003.md` | 56 |
| F-004 | Agent | `tasks_v1.17_F-004.md` | 27 |
| F-005 | Workspace, Identity and Access | `tasks_v1.17_F-005.md` | 58 |
| F-006 | Published App Surfaces | `tasks_v1.17_F-006.md` | 54 |
| F-007 | difyctl CLI | `tasks_v1.17_F-007.md` | 28 |

332 tasks in total.

## Conventions

- One task per handler module and one per owned entity, for the backend features; one per leaf command for the CLI.
- `done-when` is written as the check that would prove the task, because that is what the status column has to cash
  [D: docs/Dify-Specs/status-model.md].
- Status moves `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`. The transition guard is
  the check; skipping it defeats the mechanism.

OPEN: is a module the unit of work this team recognises? The repository records commits, not tasks, so the
granularity here is the documenter's choice and not the team's.
