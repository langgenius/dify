---
title: PRD v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# PRD v1.17 F-002 — Workflow Engine and Authoring

> **Reconstructed, and the weakest document in this hub.** A requirement states intent, and intent is not in a repository. Every story below is inferred from a group of endpoints and test names — evidence that the behaviour exists, never evidence that it was wanted, and never evidence of what it was wanted *for*.

## Summary

182 operations serve this feature [D: api/controllers/]. What they let a user accomplish is summarised by the stories below.

OPEN: what problem does this feature solve, for whom, and what changed for them when it shipped? Not recoverable.

## User stories

**F-002-US1** — As a workflow author, I want to edit a workflow as a draft without affecting the running version, so that I can experiment safely.

  I: inferred from the existence of draft workflow endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-002-US2** — As a workflow author, I want to publish a draft as a version and restore an earlier one, so that I can roll back a bad change.

  I: inferred from the existence of publish and version endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-002-US3** — As a workflow author, I want to run a single node while authoring, so that I can debug without running the whole graph.

  I: inferred from the existence of node run endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-002-US4** — As a workflow author, I want to inspect the variables a draft produced, so that I can understand why a run behaved as it did.

  I: inferred from the existence of `/console/api/apps/<app_id>/workflows/draft/variables` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-002-US5** — As a workflow author, I want to pause a run for human input and resume it when a form is submitted, so that I can put a person in the loop.

  I: inferred from the existence of human-input form endpoints — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-002-US6** — As a workflow author, I want to trigger a workflow from a webhook or a schedule, so that I can run it without a person present.

  I: inferred from the existence of `/triggers/webhook/<webhook_id>`, schedule plans — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

**F-002-US7** — As a workflow author, I want to comment on a workflow node with teammates, so that I can review a graph collaboratively.

  I: inferred from the existence of `/console/api/apps/<app_id>/workflows/comments` — basis: a coherent group of operations serves exactly this outcome and nothing else [D: api/controllers/].

OPEN: is this the list of things users actually do, or only the list the API makes possible? The two differ, and only usage data settles it.

## Acceptance criteria

Criteria are lifted from test names where a test states a contract in words — a test named "refuses X" is a Given/When/Then, and it is evidence the behaviour is wanted rather than merely present.

- `test_500_tool_catalogue_never_exceeds_global_candidate_limit` [D: api/tests/unit_tests/core/workflow/generator/test_tool_catalogue.py:240]
- `test_account_caller_rejected_for_end_user_run` [D: api/tests/unit_tests/controllers/openapi/test_workflow_events_openapi.py:160]
- `test_active_workflow_task_rejects_duplicate_task_id` [D: api/tests/unit_tests/core/app/apps/workflow/test_active_workflow_tasks.py:30]
- `test_adapt_human_input_node_data_for_graph_rejects_non_mappings` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:277]
- `test_adapt_node_config_for_graph_rejects_non_mapping_and_preserves_raw_data` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:370]
- `test_adapt_node_data_for_graph_only_rewrites_human_input_nodes` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:122]
- `test_adapt_node_data_for_graph_rejects_non_mappings` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:365]
- `test_apikey_only` [D: api/tests/unit_tests/core/trigger/test_provider.py:166]
- `test_auto_ignores_invalid_planner_mode_value` [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:1180]
- `test_between_requires_both_boundaries` [D: api/tests/unit_tests/services/test_clear_free_plan_expired_workflow_run_logs.py:468]

OPEN: no story above has acceptance criteria covering its happy path in these terms. The suite tests behaviour; it does not restate requirements.

## Implementation status

| story | Status | Evidence |
| --- | --- | --- |
| F-002-US1 | todo | — |
| F-002-US2 | todo | — |
| F-002-US3 | todo | — |
| F-002-US4 | todo | — |
| F-002-US5 | todo | — |
| F-002-US6 | todo | — |
| F-002-US7 | todo | — |

No story may read `done` without the test command and its result in the note [D: docs/Dify-Specs/status-model.md].

## Scope boundaries

OPEN: what was deliberately left out of this feature, and why? A working tree records what exists and keeps no record of what was declined.

## Dependencies

- F-005 — every operation is tenant-scoped and RBAC-guarded [D: api/controllers/console/wraps.py]

OPEN: which external systems is this feature contractually dependent on, as opposed to merely able to use?

## Metrics

OPEN: how is success measured for this feature? No metric, target or SLO appears anywhere in the repository. Telemetry is collected [D: api/tasks/enterprise_telemetry_task.py:19] but what it is read for is not stated.

