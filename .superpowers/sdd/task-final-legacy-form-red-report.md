## Goal
Add minimal RED coverage for legacy `form_definition` payloads that still use `actions` and `resolved_default_values`.

## Files Touched
- `api/tests/unit_tests/core/repositories/test_human_input_form_repository_impl.py`
- `api/tests/unit_tests/core/workflow/test_form_input_serialization_compat.py`

## What Changed
- Added a repository hydration test that feeds `HumanInputFormRecord.from_models()` a legacy persisted JSON blob with `actions` and `resolved_default_values`.
- Added a serialization compatibility test that feeds `FormDefinition` a legacy payload with the same field names.
- Updated test imports to current in-repo human-input modules so the files collect in this environment.

## Verification
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/repositories/test_human_input_form_repository_impl.py -k legacy_actions_and_default_values_during_hydration`
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_form_input_serialization_compat.py -k 'preserves_legacy_actions_and_default_values or accepts_current_serialized_payload and not with_form_data and not with_form_definition'`

## Result
- Both focused legacy cases fail at the expected point: the restored `user_actions` list is empty, which proves the current hydration path drops legacy actions/defaults.

## Notes
- There is an unrelated untracked file in the worktree: `hitl-session-binding-plan.md`.
- `pytest` also emits an existing `Unknown config option: env` warning during collection.
