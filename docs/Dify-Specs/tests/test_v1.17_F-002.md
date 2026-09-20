---
title: Test Plan v1.17 F-002 — Workflow Engine and Authoring
id: F-002
status: draft
owner: TBD
updated: 2026-09-20
---

# Test Plan v1.17 F-002 — Workflow Engine and Authoring

> **This is an as-built record.** It describes the suite that exists, not a suite to be written. Its purpose is the coverage holes listed below.

## Scope and command

3089 test cases across 252 files carry this feature's subject matter [D: survey of test function and `describe`/`it` names].

The project's own command is `make test` [D: Makefile:104], which runs `uv run --project api --dev pytest` in two passes — everything except `api/tests/unit_tests/controllers`, then the controllers [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Test files

| File | Cases |
| --- | --- |
| `api/tests/unit_tests/services/test_workflow_service.py` | 133 |
| `api/tests/unit_tests/core/workflow/generator/test_runner.py` | 125 |
| `api/tests/unit_tests/services/test_workflow_collaboration_service.py` | 57 |
| `api/tests/unit_tests/core/workflow/nodes/llm/test_node.py` | 48 |
| `api/tests/unit_tests/core/workflow/test_node_factory.py` | 48 |
| `api/tests/test_containers_integration_tests/services/test_workflow_service.py` | 47 |
| `api/tests/unit_tests/core/workflow/nodes/code/code_node_spec.py` | 45 |
| `api/tests/unit_tests/services/retention/workflow_run/test_restore_archived_workflow_run.py` | 44 |
| `api/tests/unit_tests/controllers/service_api/app/test_workflow.py` | 43 |
| `api/tests/integration_tests/services/retention/test_workflow_run_archiver.py` | 41 |
| `api/tests/unit_tests/services/retention/workflow_run/test_clear_free_plan_expired_workflow_run_logs.py` | 39 |
| `api/tests/unit_tests/models/test_workflow_models.py` | 38 |
| `api/tests/unit_tests/core/workflow/nodes/llm/test_llm_utils.py` | 37 |
| `api/tests/unit_tests/services/test_snippet_service.py` | 36 |
| `api/tests/unit_tests/core/workflow/generator/test_tool_catalogue.py` | 35 |

…237 more files.


Enumerating all 24,695 cases in the repository into this hub would duplicate the suite without adding information; the suite is the record and this document points at it.

## Representative cases

Cases whose names state a contract rather than an implementation detail:

- `test_500_tool_catalogue_never_exceeds_global_candidate_limit` [D: api/tests/unit_tests/core/workflow/generator/test_tool_catalogue.py:240]
- `test_account_caller_rejected_for_end_user_run` [D: api/tests/unit_tests/controllers/openapi/test_workflow_events_openapi.py:160]
- `test_active_workflow_task_rejects_duplicate_task_id` [D: api/tests/unit_tests/core/app/apps/workflow/test_active_workflow_tasks.py:30]
- `test_adapt_human_input_node_data_for_graph_rejects_non_mappings` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:277]
- `test_adapt_node_config_for_graph_rejects_non_mapping_and_preserves_raw_data` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:370]
- `test_adapt_node_data_for_graph_only_rewrites_human_input_nodes` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:122]
- `test_adapt_node_data_for_graph_rejects_non_mappings` [D: api/tests/unit_tests/core/workflow/test_human_input_adapter.py:365]
- `test_apikey_only` [D: api/tests/unit_tests/core/trigger/test_provider.py:166]
- `test_app_runner_streaming_failure_keeps_existing_pre_runtime_helper_behavior` [D: api/tests/unit_tests/tasks/test_workflow_execute_task.py:752]
- `test_app_runner_streaming_failure_publishes_started_then_failed_workflow_finished` [D: api/tests/unit_tests/tasks/test_workflow_execute_task.py:658]
- `test_archive_bundle_groups_returns_failed_result_after_retry_exhaustion` [D: api/tests/integration_tests/services/retention/test_workflow_run_archiver.py:437]
- `test_archive_bundle_uses_safe_rollback_when_failure_rolls_back_badly` [D: api/tests/integration_tests/services/retention/test_workflow_run_archiver.py:461]
- `test_archive_workflow_runs_raises_click_exception_when_tenant_plan_fails` [D: api/tests/unit_tests/commands/test_archive_workflow_runs.py:338]
- `test_assemble_falls_back_to_inline_process_data_when_loader_fails` [D: api/tests/unit_tests/services/test_workflow_node_execution_trace_service.py:147]
- `test_auto_planner_failure_stamps_conversational_default` [D: api/tests/unit_tests/core/workflow/generator/test_runner.py:1196]

## Coverage holes

157 of 182 operations sit in a handler file that has a matching `test_<name>.py`; 25 do not [D: api/tests/].

I: a matching test file is a weak proxy for coverage — basis: it proves a test module exists for that handler module, never that a given endpoint or branch is exercised [D: api/tests/].

Handler modules in this feature with no matching test file:

- `api/controllers/console/app/workflow_app_log.py`
- `api/controllers/console/app/workflow_comment.py`
- `api/controllers/console/app/workflow_run.py`
- `api/controllers/console/app/workflow_statistic.py`
- `api/controllers/console/app/workflow_trigger.py`

OPEN: what coverage level is required for this feature? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154] but no threshold is stated in the repository.

## Traceability

No test in this repository names a `F-002-US<k>` story or a `DOM-*-R<k>` rule, so no automated link exists between a test and a requirement [D: api/tests/].

OPEN: should tests carry requirement IDs? Without them the status tables in the domain and PRD documents cannot be filled from a test run, and every row stays unverified.

## Implementation status

| Case group | Status | Evidence |
| --- | --- | --- |
| Workflow Engine and Authoring suite | todo | — |
