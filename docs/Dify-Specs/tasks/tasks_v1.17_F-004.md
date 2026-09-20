---
title: Tasks v1.17 F-004 — Agent
id: F-004
status: draft
owner: TBD
updated: 2026-09-20
---

# Tasks v1.17 F-004 — Agent

> **As-built inventory, not a plan.** Every task below is already shipped; each points at the artifact that exists. `done-when` is written as the check that *would* prove it, because that is what the status column has to cash — and none of it has been cashed here.

## Tasks

| ID | Task | Artifact | Done-when |
| --- | --- | --- | --- |
| F-004-T001 | 28 operation(s) served by this module | `api/controllers/console/app/agent_config_inspector.py` | `make test` green for its matching test module |
| F-004-T002 | 26 operation(s) served by this module | `api/controllers/console/agent/roster.py` | `make test` green for its matching test module |
| F-004-T003 | 18 operation(s) served by this module | `api/controllers/console/agent/composer.py` | `make test` green for its matching test module |
| F-004-T004 | 7 operation(s) served by this module | `api/controllers/console/app/agent_app_sandbox.py` | `make test` green for its matching test module |
| F-004-T005 | 6 operation(s) served by this module | `api/controllers/inner_api/plugin/agent_config.py` | `make test` green for its matching test module |
| F-004-T006 | 4 operation(s) served by this module | `api/controllers/console/app/message.py` | `make test` green for its matching test module |
| F-004-T007 | 3 operation(s) served by this module | `api/controllers/console/app/completion.py` | `make test` green for its matching test module |
| F-004-T008 | 2 operation(s) served by this module | `api/controllers/inner_api/agent/files.py` | `make test` green for its matching test module |
| F-004-T009 | 1 operation(s) served by this module | `api/controllers/console/app/audio.py` | `make test` green for its matching test module |
| F-004-T010 | 1 operation(s) served by this module | `api/controllers/console/app/agent_app_feature.py` | `make test` green for its matching test module |
| F-004-T011 | 1 operation(s) served by this module | `api/controllers/console/app/agent_app_access.py` | `make test` green for its matching test module |
| F-004-T012 | 1 operation(s) served by this module | `api/controllers/inner_api/agent/llm.py` | `make test` green for its matching test module |
| F-004-T013 | 1 operation(s) served by this module | `api/controllers/inner_api/agent/tools.py` | `make test` green for its matching test module |
| F-004-T014 | Entity `agent_config_drafts` | `api/models/agent.py:283` | migration applies and the ORM class maps it |
| F-004-T015 | Entity `agent_config_revisions` | `api/models/agent.py:363` | migration applies and the ORM class maps it |
| F-004-T016 | Entity `agent_config_snapshots` | `api/models/agent.py:327` | migration applies and the ORM class maps it |
| F-004-T017 | Entity `agent_debug_conversations` | `api/models/agent.py:248` | migration applies and the ORM class maps it |
| F-004-T018 | Entity `agent_home_snapshots` | `api/models/agent.py:218` | migration applies and the ORM class maps it |
| F-004-T019 | Entity `agent_skill_binding_snapshots` | `api/models/skill.py:158` | migration applies and the ORM class maps it |
| F-004-T020 | Entity `agent_skill_bindings` | `api/models/skill.py:135` | migration applies and the ORM class maps it |
| F-004-T021 | Entity `agent_workspace_bindings` | `api/models/agent.py:502` | migration applies and the ORM class maps it |
| F-004-T022 | Entity `agent_workspaces` | `api/models/agent.py:464` | migration applies and the ORM class maps it |
| F-004-T023 | Entity `agents` | `api/models/agent.py:140` | migration applies and the ORM class maps it |
| F-004-T024 | Entity `skill_draft_files` | `api/models/skill.py:88` | migration applies and the ORM class maps it |
| F-004-T025 | Entity `skill_versions` | `api/models/skill.py:109` | migration applies and the ORM class maps it |
| F-004-T026 | Entity `skills` | `api/models/skill.py:56` | migration applies and the ORM class maps it |
| F-004-T027 | Entity `workflow_agent_node_bindings` | `api/models/agent.py:407` | migration applies and the ORM class maps it |

27 tasks.

## Status

Every row is `todo` in the table above and must move `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`; the transition guard is the check [D: docs/Dify-Specs/status-model.md].

No row may read `done` without a command and its result in the note.

OPEN: this inventory is one task per module and one per entity. Is that the unit of work the team recognises, or should a task be a user-visible capability? The repository records commits, not tasks.

## Open questions

- OPEN: what was the original sequencing? A working tree preserves the result and not the order.
- OPEN: which of these were delivered together as one release? Tags would say; the repository has none [D: survey of `git tag`].
