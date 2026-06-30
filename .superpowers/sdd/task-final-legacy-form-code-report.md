# Legacy Form Compatibility Code Report

## Change
- Added a `FormDefinition` pre-validation normalizer in `api/core/workflow/human_input/entities.py`.
- Legacy persisted keys now map locally during model hydration:
  - `actions` -> `user_actions`
  - `resolved_default_values` -> `default_values`

## Scope
- Production-only change.
- Kept the fix inside the Dify-owned form schema/hydration path.
- No test files were modified.

## Verification
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/repositories/test_human_input_form_repository_impl.py -k legacy_actions_and_default_values_during_hydration`
- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_form_input_serialization_compat.py -k 'preserves_legacy_actions_and_default_values or accepts_current_serialized_payload and not with_form_data and not with_form_definition'`

## Result
- Both focused selections passed.

## Notes
- The worktree contains an unrelated untracked file: `hitl-session-binding-plan.md`.
