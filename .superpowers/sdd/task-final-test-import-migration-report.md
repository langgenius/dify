# Final HITL Test Import Migration Report

## Scope

- Updated test-only imports under `api/tests` from legacy `graphon.nodes.human_input.entities` and `graphon.nodes.human_input.enums` to `core.workflow.human_input`.
- Kept graphon-facing pause-contract coverage in tests that are explicitly about pause reasons.
- Narrowly updated a few reviewer-cited tests from removed `HumanInputRequired` usage to current `HitlRequired` semantics where needed for collection and current contract alignment.

## Files Touched

- Reviewer-cited unit tests:
  - `api/tests/unit_tests/services/test_human_input_service.py`
  - `api/tests/unit_tests/core/repositories/test_human_input_repository.py`
  - `api/tests/unit_tests/repositories/test_sqlalchemy_execution_extra_content_repository.py`
  - `api/tests/unit_tests/core/entities/test_entities_execution_extra_content.py`
  - `api/tests/unit_tests/controllers/web/test_human_input_form.py`
  - `api/tests/unit_tests/controllers/console/app/test_workflow_pause_details_api.py`
  - `api/tests/unit_tests/controllers/service_api/app/test_hitl_service_api.py`
  - `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py`
  - `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_hitl.py`
  - `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_resume.py`
  - `api/tests/unit_tests/core/workflow/nodes/human_input/test_entities.py`
  - `api/tests/unit_tests/core/workflow/nodes/human_input/test_human_input_form_filled_event.py`
  - `api/tests/unit_tests/core/workflow/test_human_input_policy.py`
  - `api/tests/unit_tests/core/workflow/test_node_runtime.py`
- Additional directly matching unit/integration tests and test helpers under:
  - `api/tests/test_containers_integration_tests/**`
  - `api/tests/unit_tests/libs/_human_input/**`
  - `api/tests/unit_tests/services/workflow/test_workflow_human_input_delivery.py`
  - `api/tests/unit_tests/services/test_human_input_file_upload_service.py`
  - `api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline_core.py`

## Verification

### Passing focused subset

Command:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/repositories/test_human_input_repository.py \
  api/tests/unit_tests/repositories/test_sqlalchemy_execution_extra_content_repository.py \
  api/tests/unit_tests/core/entities/test_entities_execution_extra_content.py \
  api/tests/unit_tests/controllers/web/test_human_input_form.py \
  api/tests/unit_tests/controllers/console/app/test_workflow_pause_details_api.py \
  api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_hitl.py \
  api/tests/unit_tests/core/workflow/nodes/agent_v2/test_ask_human_resume.py \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/workflow/test_human_input_policy.py \
  api/tests/unit_tests/services/test_human_input_file_upload_service.py \
  api/tests/unit_tests/services/workflow/test_workflow_human_input_delivery.py \
  api/tests/unit_tests/libs/_human_input/test_models.py \
  api/tests/unit_tests/libs/_human_input/test_form_service.py
```

Result:

- `157 passed`
- Exit code `0`

### Broader collection attempt

A broader reviewer-focused run collected successfully after the import migration, but surfaced pre-existing or out-of-scope failures unrelated to the entity/enum import replacement itself:

- `api/tests/unit_tests/services/test_human_input_service.py`
  - local environment missing `pytest_mock`
- `api/tests/unit_tests/controllers/service_api/app/test_hitl_service_api.py`
  - stale pause payload expectations around legacy `PauseReasonType` / hydrated form lookup
- `api/tests/unit_tests/core/workflow/nodes/human_input/test_entities.py`
  - `HumanInputNode` constructor mismatch vs current graphon API
- `api/tests/unit_tests/core/workflow/nodes/human_input/test_human_input_form_filled_event.py`
  - same constructor mismatch
- `api/tests/unit_tests/core/workflow/graph_engine/test_parallel_human_input_join_resume.py`
  - same constructor mismatch

## Notes

- No production files were edited.
- Direct `from graphon.nodes.human_input.entities|enums import ...` test imports were eliminated from `api/tests`.
- Existing compatibility/boundary tests that intentionally reference graphon pause-contract modules by name were left intact unless they needed a narrow `HumanInputRequired` -> `HitlRequired` test update.
