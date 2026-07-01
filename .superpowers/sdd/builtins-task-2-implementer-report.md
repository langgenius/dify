# Builtins Getattr Follow-up Task 2 Implementer Report

## Scope

- Modified `scripts/ast_grep_rules/no_new_getattr.yml`
- Did not modify `scripts/check_no_new_getattr.py`
- Did not modify `api/tests/unit_tests/commands/test_check_no_new_getattr.py`

## Contract Readback

The approved Task 1 RED contract required:

- CI-mode failure for 2-arg and 3-arg `builtins.getattr(...)`
- CI-mode failure for 2-arg and 3-arg `__builtins__.getattr(...)`
- pre-commit staged failure for 2-arg and 3-arg `builtins.getattr(...)`
- Existing plain `getattr` behavior unchanged
- Suppression behavior unchanged
- Non-Python filtering unchanged
- Hunk-count semantics unchanged

## Implementation

Extended the ast-grep `any` rule from 2 patterns to 6 patterns:

```yaml
rule:
  any:
    - pattern: getattr($OBJ, $NAME)
    - pattern: getattr($OBJ, $NAME, $$$REST)
    - pattern: builtins.getattr($OBJ, $NAME)
    - pattern: builtins.getattr($OBJ, $NAME, $$$REST)
    - pattern: __builtins__.getattr($OBJ, $NAME)
    - pattern: __builtins__.getattr($OBJ, $NAME, $$$REST)
```

No wrapper-layer changes were needed. The RED failures were entirely explained by missing AST patterns.

## RED Evidence

Command:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands/test_check_no_new_getattr.py -q
```

Result before the change:

```text
6 failed, 12 passed, 1 warning in 6.59s
```

Relevant failing cases:

- `test_ci_mode_fails_for_new_file_with_builtins_getattr`
- `test_ci_mode_fails_for_new_file_with_two_arg_builtins_getattr`
- `test_ci_mode_fails_for_new_file_with_dunder_builtins_getattr`
- `test_ci_mode_fails_for_new_file_with_two_arg_dunder_builtins_getattr`
- `test_pre_commit_mode_fails_for_staged_builtins_getattr`
- `test_pre_commit_mode_fails_for_staged_two_arg_builtins_getattr`

Observed behavior before the change:

- Each failing case returned `returncode == 0` instead of `1`
- Existing plain `getattr(...)` tests were already passing
- This isolated the defect to missing `builtins` / `__builtins__` rule coverage

## GREEN Evidence

Focused contract command:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands/test_check_no_new_getattr.py -q
```

Focused result after the change:

```text
18 passed, 1 warning in 6.10s
```

Broader commands suite command:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands -q
```

Broader result after the change:

```text
118 passed, 493 warnings in 10.81s
```

## Verification Notes

- The focused contract passing demonstrates the new builtins variants are now blocked in both CI and pre-commit modes.
- The broader commands suite passing demonstrates no regression in the existing wrapper contract.
- Warnings observed during pytest were pre-existing and unrelated to this change.

## Files Changed

- `scripts/ast_grep_rules/no_new_getattr.yml`
- `.superpowers/sdd/builtins-task-2-implementer-report.md`
