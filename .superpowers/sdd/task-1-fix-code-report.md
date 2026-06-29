## Summary

Implemented the Task 1 production-side fixes for the HITL graphon#185 migration and included the existing Task 1-consistent import migrations already present in the worktree.

## Files Changed

- `api/core/workflow/human_input/entities.py`
- `api/core/app/entities/task_entities.py`
- `api/core/workflow/node_runtime.py`
- `api/services/workflow_service.py`

## What Changed

### 1. Runtime form-content rendering

- Implemented `render_form_content_before_submission(form_content=..., variable_pool=...)`.
- The helper now renders runtime variables through `variable_pool.convert_template(...)`.
- It preserves `{{#$output.*#}}` placeholders because those remain untouched by the runtime template conversion contract.
- It prefers `.markdown` when available and falls back to `.text`, then the original source string.

### 2. Input-derived selector mapping

- Fixed `HumanInputNodeData.extract_variable_selector_to_variable_mapping(...)` so input-derived selectors keep their full selector path.
- Template-derived selectors still follow the existing `SELECTORS_LENGTH` trimming behavior.
- This restores mappings like `human-node.#input.profile.bio# -> ["input", "profile", "bio"]`.

### 3. Custom file validation

- Tightened `_FileInputCommonConfig` validation so `allowed_file_extensions` is required whenever `FileType.CUSTOM` appears in `allowed_file_types`, not only when it is the sole allowed type.
- Added submission-time file validation for `file` and `file-list` inputs.
- Reused `factories.file_factory.validation.is_file_valid_with_config(...)` with a constructed `FileUploadConfig` so custom-extension enforcement matches Dify’s existing file bucket semantics.

### 4. Task 1 import migration follow-through

- Included the pre-existing import migration changes in:
  - `api/core/app/entities/task_entities.py`
  - `api/core/workflow/node_runtime.py`
  - `api/services/workflow_service.py`
- `node_runtime.py` now reuses the Dify-owned `restore_submitted_data(...)` helper instead of duplicating restoration logic.

## Verification

Required command:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/workflow/human_input/test_package_contract.py \
  api/tests/unit_tests/core/workflow/human_input/test_runtime_helpers_red.py \
  api/tests/unit_tests/core/workflow/human_input/test_session_binding.py \
  api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py
```

Result:

- `17 passed`

Additional focused check attempted:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/services/test_workflow_service.py -k 'human_input'
```

Result:

- `8 passed, 1 failed`
- The failing case is `TestWorkflowServiceFreeNodeExecution.test_validate_human_input_node_data_error`.
- It patches `graphon.nodes.human_input.entities.HumanInputNodeData.model_validate`, but `workflow_service.py` now correctly imports the Dify-owned `HumanInputNodeData`, so the patch no longer intercepts the call.

Additional service-focused check attempted:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/services/test_human_input_service.py \
  -k 'normalize_submission_data or validate_and_normalize_submission'
```

Result:

- Could not collect locally because `pytest_mock` is missing in this environment (`ModuleNotFoundError: No module named 'pytest_mock'`).

## Concerns

- There is at least one adjacent unit test outside the required Task 1 suite that still assumes the old graphon import path in `workflow_service.py`. Production behavior is aligned with Task 1, but that test will need a follow-up update to patch the Dify-owned import instead.
