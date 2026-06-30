# Stale HITL Contract Test Migration Report

## Scope

Updated only the requested test files:

- `api/tests/test_containers_integration_tests/services/workflow/test_workflow_event_snapshot_service.py`
- `api/tests/test_containers_integration_tests/repositories/test_sqlalchemy_api_workflow_run_repository.py`
- `api/tests/test_containers_integration_tests/controllers/web/test_human_input_form.py`
- `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py`

## What Changed

- Replaced stale graphon-facing `HumanInputRequired(...)` test fixtures/imports with `HitlRequired(session_id, node_id, node_title)`.
- Switched graphon-boundary assertions to `session_id` / `node_id` / `node_title`.
- Preserved Dify outward payload expectations by asserting hydrated `form_id` on outward responses/events instead of expecting `form_id` to live on the pause reason.
- Kept the current clarification intact: outward payloads expose Dify `form_id`, while `session_id` stays at the graphon boundary.

## File Notes

### `test_workflow_event_snapshot_service.py`

- Fake pause entity now carries `Sequence[HitlRequired]`.
- Snapshot test now builds a pause reason with `session_binding.issue_session_id_for_form(...)`.
- The rich event assertion remains on the hydrated outward event payload:
  - `human_input_required.data.form_id == form.id`
  - runtime-resolved select options still come from hydrated form definition + variable pool.

### `test_sqlalchemy_api_workflow_run_repository.py`

- `_build_human_input_required_reason(...)` assertions now verify the graphon pause contract only:
  - returned type is `HitlRequired`
  - `session_id` is derived from `session_binding.issue_session_id_for_form(form_id=...)`
  - `node_id` / `node_title` remain correct
- Removed stale assertions for `form_content`, `inputs`, `actions`, and `resolved_default_values`, because those no longer belong to the graphon pause reason.

### `test_human_input_form.py`

- Workflow pause setup now uses `HitlRequired` with `session_id`.
- Endpoint assertions continue to validate hydrated outward payload behavior, including:
  - `body["form_id"] == form.id`
  - variable-backed select options are resolved into outward `inputs`.

### `test_agent_node.py`

- Updated unit tests to import/use `HitlRequired`.
- Pause assertions now check `reason.session_id` rather than `reason.form_id`.
- Resume-repause test now injects a `HitlRequired` and verifies the node re-emits that graphon pause contract.

## Verification

Commands run:

```bash
uv run --project api --group dev pytest -o addopts='' api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py
uv run --project api --group dev pytest -o addopts='' api/tests/test_containers_integration_tests/services/workflow/test_workflow_event_snapshot_service.py api/tests/test_containers_integration_tests/repositories/test_sqlalchemy_api_workflow_run_repository.py api/tests/test_containers_integration_tests/controllers/web/test_human_input_form.py
```

Observed results:

- `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py`: `17 passed`
- Integration selections: test collection succeeded, but execution stopped during `testcontainers` session setup because Docker daemon was unavailable:
  - `docker.errors.DockerException: Error while fetching server API version`
  - underlying socket error: `FileNotFoundError(2, 'No such file or directory')`

## Concerns

- I could not complete runtime verification for the three integration files in this environment because the required Docker daemon is unavailable.
- The updated integration files did get past Python import/pytest collection under `--group dev`, which is useful evidence that the stale `HumanInputRequired` imports/contracts were removed, but it is not a substitute for full container-backed execution.
