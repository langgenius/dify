---
title: Tasks v1.17 F-001 — App Studio and Publishing
id: F-001
status: draft
owner: TBD
updated: 2026-09-20
---

# Tasks v1.17 F-001 — App Studio and Publishing

> **As-built inventory, not a plan.** Every task below is already shipped; each points at the artifact that exists. `done-when` is written as the check that *would* prove it, because that is what the status column has to cash — and none of it has been cashed here.

## Tasks

| ID | Task | Artifact | Done-when |
| --- | --- | --- | --- |
| F-001-T001 | 18 operation(s) served by this module | `api/controllers/console/app/app.py` | `make test` green for its matching test module |
| F-001-T002 | 13 operation(s) served by this module | `api/controllers/console/app/annotation.py` | `make test` green for its matching test module |
| F-001-T003 | 8 operation(s) served by this module | `api/controllers/console/app/statistic.py` | `make test` green for its matching test module |
| F-001-T004 | 8 operation(s) served by this module | `api/controllers/console/app/generator.py` | `make test` green for its matching test module |
| F-001-T005 | 6 operation(s) served by this module | `api/controllers/console/extension.py` | `make test` green for its matching test module |
| F-001-T006 | 6 operation(s) served by this module | `api/controllers/console/feature.py` | `make test` green for its matching test module |
| F-001-T007 | 6 operation(s) served by this module | `api/controllers/console/app/message.py` | `make test` green for its matching test module |
| F-001-T008 | 6 operation(s) served by this module | `api/controllers/console/app/conversation.py` | `make test` green for its matching test module |
| F-001-T009 | 6 operation(s) served by this module | `api/controllers/console/tag/tags.py` | `make test` green for its matching test module |
| F-001-T010 | 4 operation(s) served by this module | `api/controllers/console/app/completion.py` | `make test` green for its matching test module |
| F-001-T011 | 4 operation(s) served by this module | `api/controllers/console/app/mcp_server.py` | `make test` green for its matching test module |
| F-001-T012 | 4 operation(s) served by this module | `api/controllers/console/app/ops_trace.py` | `make test` green for its matching test module |
| F-001-T013 | 4 operation(s) served by this module | `api/controllers/console/files.py` | `make test` green for its matching test module |
| F-001-T014 | 3 operation(s) served by this module | `api/controllers/console/app/audio.py` | `make test` green for its matching test module |
| F-001-T015 | 3 operation(s) served by this module | `api/controllers/console/app/app_import.py` | `make test` green for its matching test module |
| F-001-T016 | 2 operation(s) served by this module | `api/controllers/console/app/site.py` | `make test` green for its matching test module |
| F-001-T017 | 2 operation(s) served by this module | `api/controllers/console/notification.py` | `make test` green for its matching test module |
| F-001-T018 | 2 operation(s) served by this module | `api/controllers/console/onboarding.py` | `make test` green for its matching test module |
| F-001-T019 | 2 operation(s) served by this module | `api/controllers/console/remote_files.py` | `make test` green for its matching test module |
| F-001-T020 | 1 operation(s) served by this module | `api/controllers/console/app/advanced_prompt_template.py` | `make test` green for its matching test module |
| F-001-T021 | 1 operation(s) served by this module | `api/controllers/console/app/agent.py` | `make test` green for its matching test module |
| F-001-T022 | 1 operation(s) served by this module | `api/controllers/console/app/conversation_variables.py` | `make test` green for its matching test module |
| F-001-T023 | 1 operation(s) served by this module | `api/controllers/console/app/model_config.py` | `make test` green for its matching test module |
| F-001-T024 | 1 operation(s) served by this module | `api/controllers/console/spec.py` | `make test` green for its matching test module |
| F-001-T025 | Entity `account_trial_app_records` | `api/models/model.py:1026` | migration applies and the ORM class maps it |
| F-001-T026 | Entity `api_requests` | `api/models/model.py:2414` | migration applies and the ORM class maps it |
| F-001-T027 | Entity `app_annotation_hit_histories` | `api/models/model.py:1959` | migration applies and the ORM class maps it |
| F-001-T028 | Entity `app_annotation_settings` | `api/models/model.py:1996` | migration applies and the ORM class maps it |
| F-001-T029 | Entity `app_mcp_servers` | `api/models/model.py:2122` | migration applies and the ORM class maps it |
| F-001-T030 | Entity `app_model_configs` | `api/models/model.py:717` | migration applies and the ORM class maps it |
| F-001-T031 | Entity `app_stars` | `api/models/model.py:695` | migration applies and the ORM class maps it |
| F-001-T032 | Entity `apps` | `api/models/model.py:407` | migration applies and the ORM class maps it |
| F-001-T033 | Entity `conversations` | `api/models/model.py:1109` | migration applies and the ORM class maps it |
| F-001-T034 | Entity `dify_setups` | `api/models/model.py:361` | migration applies and the ORM class maps it |
| F-001-T035 | Entity `exporle_banners` | `api/models/model.py:1051` | migration applies and the ORM class maps it |
| F-001-T036 | Entity `message_agent_thoughts` | `api/models/model.py:2454` | migration applies and the ORM class maps it |
| F-001-T037 | Entity `message_annotations` | `api/models/model.py:1914` | migration applies and the ORM class maps it |
| F-001-T038 | Entity `message_chains` | `api/models/model.py:2435` | migration applies and the ORM class maps it |
| F-001-T039 | Entity `message_feedbacks` | `api/models/model.py:1836` | migration applies and the ORM class maps it |
| F-001-T040 | Entity `message_files` | `api/models/model.py:1886` | migration applies and the ORM class maps it |
| F-001-T041 | Entity `messages` | `api/models/model.py:1442` | migration applies and the ORM class maps it |
| F-001-T042 | Entity `operation_logs` | `api/models/model.py:2054` | migration applies and the ORM class maps it |
| F-001-T043 | Entity `recommended_apps` | `api/models/model.py:926` | migration applies and the ORM class maps it |
| F-001-T044 | Entity `sites` | `api/models/model.py:2169` | migration applies and the ORM class maps it |
| F-001-T045 | Entity `tag_bindings` | `api/models/model.py:2629` | migration applies and the ORM class maps it |
| F-001-T046 | Entity `tags` | `api/models/model.py:2607` | migration applies and the ORM class maps it |
| F-001-T047 | Entity `tenant_credit_pools` | `api/models/model.py:2694` | migration applies and the ORM class maps it |
| F-001-T048 | Entity `trace_app_config` | `api/models/model.py:2649` | migration applies and the ORM class maps it |
| F-001-T049 | Entity `trial_apps` | `api/models/model.py:1003` | migration applies and the ORM class maps it |
| F-001-T050 | Entity `upload_files` | `api/models/model.py:2324` | migration applies and the ORM class maps it |

50 tasks.

## Status

Every row is `todo` in the table above and must move `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`; the transition guard is the check [D: docs/Dify-Specs/status-model.md].

No row may read `done` without a command and its result in the note.

OPEN: this inventory is one task per module and one per entity. Is that the unit of work the team recognises, or should a task be a user-visible capability? The repository records commits, not tasks.

## Open questions

- OPEN: what was the original sequencing? A working tree preserves the result and not the order.
- OPEN: which of these were delivered together as one release? Tags would say; the repository has none [D: survey of `git tag`].
