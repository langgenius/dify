# HITL Graphon Pause Contract RED Report

## Scope

Added focused RED tests for the remaining read/response paths that still assume
the legacy rich human-input pause reason shape:

- `api/tests/unit_tests/core/app/apps/common/test_workflow_response_converter_hitl_contract_red.py`
- `api/tests/unit_tests/services/workflow/test_workflow_event_snapshot_service_hitl_contract_red.py`
- `api/tests/unit_tests/core/workflow/test_human_input_policy_hitl_contract_red.py`

These tests pin the new minimal graphon HITL pause contract:

- graphon pause reason uses `HitlRequired(session_id, node_id, node_title)`
- Dify response/snapshot hydration must rebuild `form_content`, `inputs`,
  `actions`, and `resolved_default_values` from persisted `form_definition`
- outward payload keeps exposing the graphon-facing id value
  (`HumanInputRequiredResponse.data.form_id == session_id`)
- internal lookups resolve Dify `form_id` through session binding

## Verification

Executed focused pytest selections only:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/core/app/apps/common/test_workflow_response_converter_hitl_contract_red.py
uv run --project api pytest -o addopts='' api/tests/unit_tests/services/workflow/test_workflow_event_snapshot_service_hitl_contract_red.py
uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_human_input_policy_hitl_contract_red.py
```

## Observed RED Failures

### 1. `workflow_response_converter` import path fails on legacy pause-reason enum usage

Test:

- `api/tests/unit_tests/core/app/apps/common/test_workflow_response_converter_hitl_contract_red.py`

Failure:

- importing `core.app.apps.common.workflow_response_converter`
- cascades into `api/core/app/entities/task_entities.py`
- `HumanInputRequiredPauseReasonPayload` still references
  `PauseReasonType.HUMAN_INPUT_REQUIRED`
- current graphon exposes `PauseReasonType.LEGACY_HUMAN_INPUT_REQUIRED` and
  `PauseReasonType.HITL_REQUIRED`, so import fails with `AttributeError`

Why this is the intended RED:

- the response path is still pinned to the legacy graphon pause-reason contract
- it cannot yet even load under the installed minimal graphon contract

### 2. `workflow_event_snapshot_service` import path fails through the same legacy payload model

Test:

- `api/tests/unit_tests/services/workflow/test_workflow_event_snapshot_service_hitl_contract_red.py`

Failure:

- importing `services.workflow_event_snapshot_service`
- cascades into `api/core/app/entities/task_entities.py`
- same `PauseReasonType.HUMAN_INPUT_REQUIRED` reference raises `AttributeError`

Why this is the intended RED:

- snapshot hydration still depends on legacy pause-reason payload definitions
- once imports are migrated, the added assertions will further require
  reconstruction from `form_definition` instead of pause-reason rich fields

### 3. `human_input_policy` still imports removed graphon class

Test:

- `api/tests/unit_tests/core/workflow/test_human_input_policy_hitl_contract_red.py`

Failure:

- importing `core.workflow.human_input_policy`
- still tries to import `HumanInputRequired` from
  `graphon.entities.pause_reason`
- current graphon no longer exports that class

Why this is the intended RED:

- the helper layer is still typed against the removed rich pause-reason model
- this must move to `HitlRequired` / `PauseReason` with `session_id`

## Notes

- I intentionally kept the new tests narrow and test-only.
- The response/snapshot tests are written so that after import-level migration
  they will continue enforcing hydration from persisted `form_definition`
  instead of any pause-reason-owned rich fields.
