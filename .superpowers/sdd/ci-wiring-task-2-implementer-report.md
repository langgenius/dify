# CI Wiring Task 2 Implementer Report

## Scope

- Modified `.github/workflows/style.yml`.
- Did not modify `api/tests/unit_tests/commands/test_check_no_new_getattr.py` because the approved workflow contract was already reflected there.

## Changes Made

### 1. Expanded the `python-style` changed-files filter

Updated the `Check changed files` step in the `python-style` job to include:

- `api/**`
- `scripts/check_no_new_getattr.py`
- `scripts/ast_grep_rules/no_new_getattr.yml`
- `.github/workflows/style.yml`

This ensures the Python style job runs when the guard implementation, its ast-grep rule, API code, or the workflow itself changes.

### 2. Added the CI guard step to the `python-style` job

Inserted a new step:

```yaml
- name: Run No New Getattr Guard
  if: steps.changed-files.outputs.any_changed == 'true'
  run: uv run --project api python scripts/check_no_new_getattr.py --mode ci --merge-target main
```

This reuses the existing UV/Python setup and dependency installation already present in the job, matching the approved CI-only contract without adding pre-commit integration.

## Verification

Ran the required focused test:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands/test_check_no_new_getattr.py -q
```

Result:

- `19 passed, 1 warning in 5.78s`

Ran the broader commands suite:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands -q
```

Result:

- `119 passed, 493 warnings in 10.30s`

## Notes

- The test runs emitted pre-existing warnings unrelated to this CI wiring change, including a `PytestConfigWarning` about `env` and some deprecation warnings from existing codepaths.
- No other files were edited.
