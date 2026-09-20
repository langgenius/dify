---
title: Tasks v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# Tasks v1.17 F-002 — Workflow Engine and Authoring

> **As-built inventory, not a plan.** Every task below is already shipped; each points at the artifact that exists. `done-when` is written as the check that *would* prove it, because that is what the status column has to cash — and none of it has been cashed here.

## Tasks

| ID | Task | Artifact | Done-when |
| --- | --- | --- | --- |
| F-002-T001 | 30 operation(s) served by this module | `api/controllers/console/app/workflow.py` | `make test` green for its matching test module |
| F-002-T002 | 19 operation(s) served by this module | `api/controllers/console/snippets/snippet_workflow.py` | `make test` green for its matching test module |
| F-002-T003 | 18 operation(s) served by this module | `api/controllers/console/workspace/trigger_providers.py` | `make test` green for its matching test module |
| F-002-T004 | 14 operation(s) served by this module | `api/controllers/trigger/webhook.py` | `make test` green for its matching test module |
| F-002-T005 | 13 operation(s) served by this module | `api/controllers/console/app/workflow_draft_variable.py` | `make test` green for its matching test module |
| F-002-T006 | 11 operation(s) served by this module | `api/controllers/console/snippets/snippet_workflow_draft_variable.py` | `make test` green for its matching test module |
| F-002-T007 | 10 operation(s) served by this module | `api/controllers/console/app/workflow_comment.py` | `make test` green for its matching test module |
| F-002-T008 | 10 operation(s) served by this module | `api/controllers/console/workspace/snippets.py` | `make test` green for its matching test module |
| F-002-T009 | 8 operation(s) served by this module | `api/controllers/console/app/workflow_node_output_inspector.py` | `make test` green for its matching test module |
| F-002-T010 | 7 operation(s) served by this module | `api/controllers/console/app/workflow_run.py` | `make test` green for its matching test module |
| F-002-T011 | 7 operation(s) served by this module | `api/controllers/trigger/trigger.py` | `make test` green for its matching test module |
| F-002-T012 | 5 operation(s) served by this module | `api/controllers/service_api/app/workflow.py` | `make test` green for its matching test module |
| F-002-T013 | 4 operation(s) served by this module | `api/controllers/console/app/workflow_statistic.py` | `make test` green for its matching test module |
| F-002-T014 | 4 operation(s) served by this module | `api/controllers/console/workflow_run_archive.py` | `make test` green for its matching test module |
| F-002-T015 | 3 operation(s) served by this module | `api/controllers/web/human_input_form.py` | `make test` green for its matching test module |
| F-002-T016 | 3 operation(s) served by this module | `api/controllers/console/app/workflow_trigger.py` | `make test` green for its matching test module |
| F-002-T017 | 3 operation(s) served by this module | `api/controllers/console/human_input_form.py` | `make test` green for its matching test module |
| F-002-T018 | 2 operation(s) served by this module | `api/controllers/web/workflow.py` | `make test` green for its matching test module |
| F-002-T019 | 2 operation(s) served by this module | `api/controllers/console/explore/workflow.py` | `make test` green for its matching test module |
| F-002-T020 | 2 operation(s) served by this module | `api/controllers/openapi/human_input_form.py` | `make test` green for its matching test module |
| F-002-T021 | 2 operation(s) served by this module | `api/controllers/service_api/app/human_input_form.py` | `make test` green for its matching test module |
| F-002-T022 | 1 operation(s) served by this module | `api/controllers/web/human_input_file_upload.py` | `make test` green for its matching test module |
| F-002-T023 | 1 operation(s) served by this module | `api/controllers/web/workflow_events.py` | `make test` green for its matching test module |
| F-002-T024 | 1 operation(s) served by this module | `api/controllers/console/app/workflow_app_log.py` | `make test` green for its matching test module |
| F-002-T025 | 1 operation(s) served by this module | `api/controllers/openapi/workflow_events.py` | `make test` green for its matching test module |
| F-002-T026 | 1 operation(s) served by this module | `api/controllers/service_api/app/workflow_events.py` | `make test` green for its matching test module |
| F-002-T027 | Entity `app_triggers` | `api/models/trigger.py:435` | migration applies and the ORM class maps it |
| F-002-T028 | Entity `celery_taskmeta` | `api/models/task.py:14` | migration applies and the ORM class maps it |
| F-002-T029 | Entity `celery_tasksetmeta` | `api/models/task.py:41` | migration applies and the ORM class maps it |
| F-002-T030 | Entity `customized_snippets` | `api/models/snippet.py:26` | migration applies and the ORM class maps it |
| F-002-T031 | Entity `execution_extra_contents` | `api/models/execution_extra_content.py:17` | migration applies and the ORM class maps it |
| F-002-T032 | Entity `human_input_form_deliveries` | `api/models/human_input.py:98` | migration applies and the ORM class maps it |
| F-002-T033 | Entity `human_input_form_recipients` | `api/models/human_input.py:221` | migration applies and the ORM class maps it |
| F-002-T034 | Entity `human_input_form_upload_files` | `api/models/human_input.py:314` | migration applies and the ORM class maps it |
| F-002-T035 | Entity `human_input_form_upload_tokens` | `api/models/human_input.py:283` | migration applies and the ORM class maps it |
| F-002-T036 | Entity `human_input_forms` | `api/models/human_input.py:28` | migration applies and the ORM class maps it |
| F-002-T037 | Entity `trigger_oauth_system_clients` | `api/models/trigger.py:161` | migration applies and the ORM class maps it |
| F-002-T038 | Entity `trigger_oauth_tenant_clients` | `api/models/trigger.py:188` | migration applies and the ORM class maps it |
| F-002-T039 | Entity `trigger_subscriptions` | `api/models/trigger.py:67` | migration applies and the ORM class maps it |
| F-002-T040 | Entity `workflow_app_logs` | `api/models/workflow.py:1308` | migration applies and the ORM class maps it |
| F-002-T041 | Entity `workflow_archive_logs` | `api/models/workflow.py:1398` | migration applies and the ORM class maps it |
| F-002-T042 | Entity `workflow_comment_mentions` | `api/models/comment.py:187` | migration applies and the ORM class maps it |
| F-002-T043 | Entity `workflow_comment_replies` | `api/models/comment.py:139` | migration applies and the ORM class maps it |
| F-002-T044 | Entity `workflow_comments` | `api/models/comment.py:18` | migration applies and the ORM class maps it |
| F-002-T045 | Entity `workflow_conversation_variables` | `api/models/workflow.py:1503` | migration applies and the ORM class maps it |
| F-002-T046 | Entity `workflow_draft_variable_files` | `api/models/workflow.py:2006` | migration applies and the ORM class maps it |
| F-002-T047 | Entity `workflow_draft_variables` | `api/models/workflow.py:1536` | migration applies and the ORM class maps it |
| F-002-T048 | Entity `workflow_node_execution_offload` | `api/models/workflow.py:1199` | migration applies and the ORM class maps it |
| F-002-T049 | Entity `workflow_node_executions` | `api/models/workflow.py:951` | migration applies and the ORM class maps it |
| F-002-T050 | Entity `workflow_pause_reasons` | `api/models/workflow.py:2162` | migration applies and the ORM class maps it |
| F-002-T051 | Entity `workflow_pauses` | `api/models/workflow.py:2094` | migration applies and the ORM class maps it |
| F-002-T052 | Entity `workflow_plugin_triggers` | `api/models/trigger.py:389` | migration applies and the ORM class maps it |
| F-002-T053 | Entity `workflow_run_archive_bundles` | `api/models/workflow.py:1467` | migration applies and the ORM class maps it |
| F-002-T054 | Entity `workflow_runs` | `api/models/workflow.py:790` | migration applies and the ORM class maps it |
| F-002-T055 | Entity `workflow_schedule_plans` | `api/models/trigger.py:484` | migration applies and the ORM class maps it |
| F-002-T056 | Entity `workflow_trigger_logs` | `api/models/trigger.py:221` | migration applies and the ORM class maps it |
| F-002-T057 | Entity `workflow_version_counters` | `api/models/workflow.py:749` | migration applies and the ORM class maps it |
| F-002-T058 | Entity `workflow_webhook_triggers` | `api/models/trigger.py:332` | migration applies and the ORM class maps it |
| F-002-T059 | Entity `workflows` | `api/models/workflow.py:177` | migration applies and the ORM class maps it |

59 tasks.

## Status

Every row is `todo` in the table above and must move `todo -> wip -> done` through `product-docs-flow/scripts/docs_flow.py task`; the transition guard is the check [D: docs/Dify-Specs/status-model.md].

No row may read `done` without a command and its result in the note.

OPEN: this inventory is one task per module and one per entity. Is that the unit of work the team recognises, or should a task be a user-visible capability? The repository records commits, not tasks.

## Open questions

- OPEN: what was the original sequencing? A working tree preserves the result and not the order.
- OPEN: which of these were delivered together as one release? Tags would say; the repository has none [D: survey of `git tag`].
