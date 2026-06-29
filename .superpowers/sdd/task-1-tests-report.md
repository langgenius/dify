# Task 1 RED Test Report

## Scope

- Worker role: Task 1 test worker for HITL `graphon#185` migration.
- Ownership respected: test files only.
- Source of truth: `.superpowers/sdd/task-1-brief.md`.

## Added Tests

- `api/tests/unit_tests/core/workflow/human_input/test_session_binding.py`
  - Requires `core.workflow.human_input.session_binding`.
  - Requires `SessionBinding` plus module singleton `session_binding`.
  - Requires Phase 1 identity mapping round-trip: `session_id == form_id`.
- `api/tests/unit_tests/core/workflow/human_input/test_package_contract.py`
  - Requires Dify-owned `core.workflow.human_input` package exports for form entities/enums/helpers used by Dify.
  - Requires package-level validation helper behavior for valid select/file/file-list submissions.
  - Requires package-level rejection of invalid select/file/file-list payloads.
- `api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py`
  - Requires Task 1 production files to move human-input semantics imports from `graphon.nodes.human_input.*` to `core.workflow.human_input`.

## RED Verification

Focused command used:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/workflow/human_input/test_session_binding.py \
  api/tests/unit_tests/core/workflow/human_input/test_package_contract.py \
  api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py
```

Observed result:

- `13 failed` in `0.36s`

Expected failure reasons:

1. `core.workflow.human_input` package does not exist yet.
2. `core.workflow.human_input.session_binding` module does not exist yet.
3. Task 1 target files still import `graphon.nodes.human_input.*` or do not yet import `core.workflow.human_input`.

Representative failures:

- `test_session_binding_exports_class_and_singleton`
  - Failed with explicit message that `core.workflow.human_input.session_binding` is missing.
- `test_human_input_package_exports_dify_owned_form_contract`
  - Failed with explicit message that `core.workflow.human_input` is missing.
- `test_task1_human_input_semantics_move_off_graphon_imports[...]`
  - Failed because target production files do not yet import from `core.workflow.human_input`, and `services/human_input_service.py` still references `graphon.nodes.human_input`.

## Environment Note

The repo `api/pytest.ini` currently injects coverage flags that are unavailable in this test environment. Running the command without overriding addopts fails before test execution with:

```text
pytest: error: unrecognized arguments: --cov=./api --cov-report=json --cov-branch --cov-report=xml
```

For this RED verification, `-o addopts=''` was required to execute the focused tests and observe the intended failures.

## Commit

Failing tests were committed after RED verification.
