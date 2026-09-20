---
title: Domain — Workflow Engine and Authoring
id: DOM-002
feature: F-002
kind: domain
status: draft
owner: TBD
updated: 2026-09-20
---

# Domain — Workflow Engine and Authoring (DOM-002)

> Reconstructed from the code. Terms are the identifiers the code uses; rules are promoted from comments that state a rule, and each names the code that enforces it.

## Ubiquitous language

The enumerations the schema constrains are the domain's own vocabulary — every value below is a string the database will accept and no other.

| Term | Permitted values | Source |
| --- | --- | --- |
| `app_triggers.trigger_type` | unknown | `api/models/trigger.py:435` |
| `app_triggers.status` | enabled, disabled, unauthorized, rate_limited | `api/models/trigger.py:435` |
| `trigger_subscriptions.credential_type` | trigger_subscription, builtin_tool_provider, datasource_provider, provider_credential | `api/models/trigger.py:67` |
| `trigger_subscriptions.visibility` | only_me, all_team_members, partial_members | `api/models/trigger.py:67` |
| `workflow_app_logs.created_from` | service-api, web-app, installed-app, openapi | `api/models/workflow.py:1308` |
| `workflow_app_logs.created_by_role` | account, end_user | `api/models/workflow.py:1308` |
| `workflow_archive_logs.created_by_role` | account, end_user | `api/models/workflow.py:1398` |
| `workflow_archive_logs.log_created_from` | service-api, web-app, installed-app, openapi | `api/models/workflow.py:1398` |
| `workflow_archive_logs.run_triggered_from` | debugging, app-run, rag-pipeline-run, rag-pipeline-debugging, webhook, schedule, plugin | `api/models/workflow.py:1398` |
| `workflow_draft_variable_files.value_type` | automatic, customized | `api/models/workflow.py:2006` |
| `workflow_draft_variables.value_type` | automatic, customized | `api/models/workflow.py:1536` |
| `workflow_node_execution_offload.type_` | inputs, process_data, outputs | `api/models/workflow.py:1199` |
| `workflow_node_executions.triggered_from` | single-step, workflow-run, rag-pipeline-run | `api/models/workflow.py:951` |
| `workflow_node_executions.created_by_role` | account, end_user | `api/models/workflow.py:951` |
| `workflow_runs.type` | workflow, chat, rag-pipeline, snippet | `api/models/workflow.py:790` |
| `workflow_runs.triggered_from` | debugging, app-run, rag-pipeline-run, rag-pipeline-debugging, webhook, schedule, plugin | `api/models/workflow.py:790` |
| `workflow_runs.created_by_role` | account, end_user | `api/models/workflow.py:790` |
| `workflow_trigger_logs.trigger_type` | unknown | `api/models/trigger.py:221` |
| `workflow_trigger_logs.status` | pending, queued, running, succeeded, paused, failed, rate_limited, retrying | `api/models/trigger.py:221` |
| `workflow_trigger_logs.created_by_role` | account, end_user | `api/models/trigger.py:221` |
| `workflows.type` | workflow, chat, rag-pipeline, snippet | `api/models/workflow.py:177` |
| `workflows.kind` | standard, snippet | `api/models/workflow.py:177` |

OPEN: several enum values carry no visible meaning beyond their spelling. What distinguishes them to a user?

## Actors

| Actor | Does | Evidence |
| --- | --- | --- |
| Workflow author | edits a draft graph and publishes a version | `api/controllers/console/app/workflow.py` |
| Workflow runner | triggers a run, by hand, schedule or webhook | `api/controllers/trigger/webhook.py:59` |
| Human-input recipient | completes a form a paused run is waiting on | `api/controllers/web/human_input_form.py:141` |

OPEN: which of these are distinct personas to the business, and which are the same person in two modes? The code models permissions, not people.

## Business rules

Promoted from 24 rule-bearing comments in this feature's files. Each is `I:` — a comment is evidence that someone knew the rule, not proof the code still enforces it.

**DOM-002-R1** — I: A RUNTIME form must be owned by at least one of: a workflow run (workflow / Human-Input / agent node) or a conversation turn (ENG-635: Agent v2 chat ask_human; chatflow runs set both — workflow_run_id and conversation_id). — basis: stated in a comment at the enforcement site [D: api/core/repositories/human_input_repository.py:453]

**DOM-002-R2** — I: Concrete mode for envelopes emitted before the planner resolved one. ``auto`` maps to the conversational default — the same never-fail fallback the old standalone classifier used — so ``result.mode`` never leaks the ``auto`` sentinel to the frontend. — basis: stated in a comment at the enforcement site [D: api/core/workflow/generator/runner.py:249]

**DOM-002-R3** — I: Merge one bundle into its shard index. Retries for a known manifest set ``require_existing_index`` so they never create a partial index by scanning or overwriting a shard whose historical entries cannot be proven from this one manifest. — basis: stated in a comment at the enforcement site [D: api/services/retention/workflow_run/archive_paid_plan_workflow_run.py:1040]

**DOM-002-R4** — I: The iteration-start → llm edge (both children of node2) must be flagged isInIteration with iteration_id pointing at the container. The edges crossing the container boundary must NOT be flagged. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:2245]

**DOM-002-R5** — I: Even though older callers only read ``error``, the new ``errors`` field must be an empty list on success — never missing — so the frontend's ``res.errors?.[0]?.code`` lookup is type-safe. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:3183]

**DOM-002-R6** — I: The LLM node references a key the CODE node never declares, but the source exposes exactly one output. Postprocessing can therefore repair the selector without guessing or changing the graph shape. — basis: stated in a comment at the enforcement site [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:3484]

**DOM-002-R7** — I: Hard ceiling on a single stream — if we never see a terminal workflow event (engine crashed, redis dropped the message), force-close after this many ticks (= seconds). — basis: stated in a comment at the enforcement site [D: api/controllers/console/app/workflow_node_output_inspector.py:66]

**DOM-002-R8** — I: Return whether one value matches the strict canonical file format. Use this when new contracts require ``dify-file-ref:...`` and raw record ids must be rejected. — basis: stated in a comment at the enforcement site [D: api/core/workflow/file_reference.py:80]

**DOM-002-R9** — I: Validate iteration / loop topology: * every container has at least one executable child whose ``parentId`` points at it; * every non-container node with a ``parentId`` points at a real container, not at a non-container node; * no cycles in the parent chain (a node cannot be its own ancestor). — basis: stated in a comment at the enforcement site [D: api/core/workflow/generator/runner.py:2608]

**DOM-002-R10** — I: The event generator always emits exactly one result envelope; this fallback only guards against a future refactor that forgets to. — basis: stated in a comment at the enforcement site [D: api/core/workflow/generator/runner.py:440]

…14 further rule-bearing comments are quoted in `architect/feature_v1.17_F-002_architect.md` and the survey.

OPEN: every rule above states *what*; none states *why*. Which are regulatory, which are product decisions, and which are workarounds?

## Process flow

Recoverable only as call sequence, not as a business process. See `architect/feature_v1.17_F-002_architect.md` and the endpoint table in `data/api-contract_v1.17_F-002.md`.

OPEN: what is the intended happy path from a user's point of view? A route table gives the operations, never the order a person performs them in.

## Invariants

Enforced by the database for this feature: 272 not-null columns and 12 cross-column uniqueness constraints [D: api/models/].

- `human_input_form_upload_files` is unique on (`upload_file_id`) [D: api/models/human_input.py:314]
- `human_input_form_upload_tokens` is unique on (`token`) [D: api/models/human_input.py:283]
- `trigger_oauth_system_clients` is unique on (`plugin_id`, `provider`) [D: api/models/trigger.py:161]
- `trigger_oauth_tenant_clients` is unique on (`tenant_id`, `plugin_id`, `provider`) [D: api/models/trigger.py:188]
- `trigger_subscriptions` is unique on (`tenant_id`, `provider_id`, `name`) [D: api/models/trigger.py:67]
- `workflow_node_execution_offload` is unique on (`node_execution_id`, `type`) [D: api/models/workflow.py:1199]
- `workflow_pauses` is unique on (`workflow_run_id`) [D: api/models/workflow.py:2094]
- `workflow_plugin_triggers` is unique on (`app_id`, `node_id`) [D: api/models/trigger.py:389]
- `workflow_run_archive_bundles` is unique on (`tenant_id`, `year`, `month`, `shard`, `bundle_id`) [D: api/models/workflow.py:1467]
- `workflow_schedule_plans` is unique on (`app_id`, `node_id`) [D: api/models/trigger.py:484]
- `workflow_webhook_triggers` is unique on (`app_id`, `node_id`) [D: api/models/trigger.py:332]
- `workflow_webhook_triggers` is unique on (`webhook_id`) [D: api/models/trigger.py:332]

I: referential invariants between these tables are enforced in service code, not by the database — basis: only 8 `ForeignKey()` declarations exist across all 143 tables [D: api/models/].

OPEN: which invariants does the business require that nothing in the code checks? Those are the ones a bad migration or a direct database write would break silently.

## Implementation status

One row per rule above. States and what `done` costs: `status-model.md`.

| Rule | Status | Evidence |
| --- | --- | --- |
| DOM-002-R1 | todo | — |
| DOM-002-R2 | todo | — |
| DOM-002-R3 | todo | — |
| DOM-002-R4 | todo | — |
| DOM-002-R5 | todo | — |
| DOM-002-R6 | todo | — |
| DOM-002-R7 | todo | — |
| DOM-002-R8 | todo | — |
| DOM-002-R9 | todo | — |
| DOM-002-R10 | todo | — |

## Open questions

- OPEN: is this feature boundary the one the team recognises? It was drawn from handler directories and table ownership, not from anyone's statement of the domain.
- OPEN: no rule in this document is named by any test. Which of them are actually verified, and which only exist as prose next to the code?
- OPEN: what is the source of truth when a comment and the code beside it disagree?
