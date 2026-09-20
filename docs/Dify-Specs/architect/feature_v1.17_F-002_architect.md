---
title: Feature Architecture v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# Feature Architecture v1.17 F-002 — Workflow Engine and Authoring

> As-built. Read with `architect.md` for system context and `architect_common.md` for the enforced layer rules.

## Design approach

I: a workflow is edited as a draft and published as an immutable version, and every run is recorded node by node — basis: the schema separates `workflows` from `workflow_runs` and `workflow_node_executions`, keeps draft state in `workflow_draft_variables`, and adds `workflow_pauses` for runs that suspend [D: api/models/workflow.py].

OPEN: why this shape and not another? The code retains no record of what was rejected, and this section states only what the code does.

## Surface

182 operations over 136 paths, on `console` (143), `trigger` (21), `service_api` (8), `web` (7), `openapi` (3) [D: api/controllers/].

Busiest handler modules:

| Module | Operations |
| --- | --- |
| `api/controllers/console/app/workflow.py` | 30 |
| `api/controllers/console/snippets/snippet_workflow.py` | 19 |
| `api/controllers/console/workspace/trigger_providers.py` | 18 |
| `api/controllers/trigger/webhook.py` | 14 |
| `api/controllers/console/app/workflow_draft_variable.py` | 13 |
| `api/controllers/console/snippets/snippet_workflow_draft_variable.py` | 11 |
| `api/controllers/console/app/workflow_comment.py` | 10 |
| `api/controllers/console/workspace/snippets.py` | 10 |

Full table in `data/api-contract_v1.17_F-002.md`.

## Components and call direction

Controllers in this feature import these application and domain modules [D: api/controllers/]:

| Module | Imported by N handler files |
| --- | --- |
| `services.errors.app` | 6 |
| `services.remote_file_service` | 6 |
| `core.workflow.human_input_policy` | 5 |
| `core.app.apps.workflow.app_generator` | 5 |
| `repositories.factory` | 5 |
| `core.app.apps.base_app_queue_manager` | 5 |
| `core.app.entities.app_invoke_entities` | 5 |
| `services.human_input_service` | 4 |
| `core.app.apps.advanced_chat.app_generator` | 4 |
| `core.app.apps.base_app_generator` | 4 |

The direction is one-way: `controllers -> services -> core -> libs`, enforced by import-linter [D: api/.importlinter:21].

## Stores

33 owned tables; field detail in `data/data-erd_v1.17_F-002.md`:

`app_triggers`, `celery_taskmeta`, `celery_tasksetmeta`, `customized_snippets`, `execution_extra_contents`, `human_input_form_deliveries`, `human_input_form_recipients`, `human_input_form_upload_files`, `human_input_form_upload_tokens`, `human_input_forms`, `trigger_oauth_system_clients`, `trigger_oauth_tenant_clients`, `trigger_subscriptions`, `workflow_app_logs`, `workflow_archive_logs`, `workflow_comment_mentions`, `workflow_comment_replies`, `workflow_comments`, `workflow_conversation_variables`, `workflow_draft_variable_files`, `workflow_draft_variables`, `workflow_node_execution_offload`, `workflow_node_executions`, `workflow_pause_reasons`, `workflow_pauses`, `workflow_plugin_triggers`, `workflow_run_archive_bundles`, `workflow_runs`, `workflow_schedule_plans`, `workflow_trigger_logs`, `workflow_version_counters`, `workflow_webhook_triggers`, `workflows`

## Stated constraints in this feature

24 rule-bearing comments sit in this feature's files. Each is a quote, not a paraphrase; the domain document promotes the ones the code enforces.

- > "A RUNTIME form must be owned by at least one of: a workflow run (workflow / Human-Input / agent node) or a conversation turn (ENG-635: Agent v2 chat ask_human; chatflow runs set both — workflow_run_id and conversation_id)." [D: api/core/repositories/human_input_repository.py:453]
- > "Concrete mode for envelopes emitted before the planner resolved one. ``auto`` maps to the conversational default — the same never-fail fallback the old standalone classifier used — so ``result.mode`` never leaks the ``auto`` sentinel to the frontend." [D: api/core/workflow/generator/runner.py:249]
- > "Merge one bundle into its shard index. Retries for a known manifest set ``require_existing_index`` so they never create a partial index by scanning or overwriting a shard whose historical entries cannot be proven from this one manifest." [D: api/services/retention/workflow_run/archive_paid_plan_workflow_run.py:1040]
- > "The iteration-start → llm edge (both children of node2) must be flagged isInIteration with iteration_id pointing at the container. The edges crossing the container boundary must NOT be flagged." [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:2245]
- > "Even though older callers only read ``error``, the new ``errors`` field must be an empty list on success — never missing — so the frontend's ``res.errors?.[0]?.code`` lookup is type-safe." [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:3183]
- > "The LLM node references a key the CODE node never declares, but the source exposes exactly one output. Postprocessing can therefore repair the selector without guessing or changing the graph shape." [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:3484]
- > "Hard ceiling on a single stream — if we never see a terminal workflow event (engine crashed, redis dropped the message), force-close after this many ticks (= seconds)." [D: api/controllers/console/app/workflow_node_output_inspector.py:66]
- > "Return whether one value matches the strict canonical file format. Use this when new contracts require ``dify-file-ref:...`` and raw record ids must be rejected." [D: api/core/workflow/file_reference.py:80]
- > "Validate iteration / loop topology: * every container has at least one executable child whose ``parentId`` points at it; * every non-container node with a ``parentId`` points at a real container, not at a non-container node; * no cycles in the parent chain (a node cannot be its own ancestor)." [D: api/core/workflow/generator/runner.py:2608]
- > "The event generator always emits exactly one result envelope; this fallback only guards against a future refactor that forgets to." [D: api/core/workflow/generator/runner.py:440]
- > "Concrete mode the planner chose ("workflow" / "advanced-chat"). Parsed leniently — an ``auto`` request infers the mode from the terminal node when this is missing or invalid, so a bad value never fails the plan." [D: api/core/workflow/generator/types.py:97]
- > "Raised when a graph pause reason cannot be resolved into Dify-owned form state." [D: api/core/workflow/nodes/human_input/boundary.py:26]

…and 12 more in the survey.


## Failure modes

Errors surface as typed exceptions rendered by the blueprint's handler; the guards in the contract table reject before the handler runs [D: api/controllers/].

OPEN: what should a caller do on each failure — retry, back off, or give up? The code raises and the client decides, and no document states the intended client behaviour.

## Observability

Shared for the whole backend: OpenTelemetry, Sentry and structured request logging are attached as extensions [D: api/extensions/ext_otel.py; api/extensions/ext_sentry.py; api/extensions/ext_request_logging.py].

OPEN: which signals in this feature are alerted on? No alert rule lives in this repository.

## Open questions

- OPEN: what are the latency and throughput targets for this feature? None is expressed anywhere.
- OPEN: which of the constraints quoted above are still true? A comment is evidence that someone knew the rule when they wrote it, not that the code beside it still enforces it.
- OPEN: rejected alternatives for this design. Not recoverable from a working tree.
