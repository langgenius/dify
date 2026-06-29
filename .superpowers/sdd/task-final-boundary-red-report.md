# Boundary Red Report

- Change: added `services/workflow_service.py` to the `no-graphon-human-input` import boundary assertion in `api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py`.
- Verification: `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/human_input/test_migration_boundaries.py`
- Result: the focused test fails as expected on `services/workflow_service.py` because it still imports `graphon.nodes.human_input`.
- Notes: no production files were modified; an unrelated untracked file `hitl-session-binding-plan.md` was left untouched.
