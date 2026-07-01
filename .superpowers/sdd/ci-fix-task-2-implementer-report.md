# Task 2 Implementer Report

## Scope

- Modified `.github/workflows/style.yml` only.
- Did not change `api/tests/unit_tests/commands/test_check_no_new_getattr.py` because the approved contract was already present and correctly failed before the workflow fix.

## Root Cause Alignment

- The `python-style` job runs `scripts/check_no_new_getattr.py --mode ci --merge-target main`.
- In CI, `actions/checkout` with the default shallow fetch can leave the local repository without a resolvable `main` ref.
- That breaks `git merge-base main HEAD` inside the guard with `fatal: Not a valid object name main`.

## Implementation

- Updated the `python-style` job checkout step to include:

```yaml
with:
  fetch-depth: 0
  persist-credentials: false
```

- Kept the guard invocation unchanged, per contract:

```yaml
uv run --project api python scripts/check_no_new_getattr.py --mode ci --merge-target main
```

## TDD / Verification Evidence

### Red

- Ran:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands/test_check_no_new_getattr.py -q
```

- Observed failure in `test_style_workflow_wires_no_new_getattr_guard` because `fetch-depth: 0` was missing from the `python-style` checkout step.

### Green

- Re-ran the focused contract test after the workflow edit:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands/test_check_no_new_getattr.py -q
```

- Result: `19 passed, 1 warning`.

### Broader Regression Check

- Ran:

```bash
uv run --project api pytest -o addopts='' api/tests/unit_tests/commands -q
```

- Result: `119 passed, 493 warnings`.

## Risk Assessment

- Behavioral risk is low: this change only affects checkout depth in the `python-style` job.
- Runtime cost may increase slightly because the job now fetches full history, but this is the approved tradeoff to guarantee the merge target ref exists for the unchanged guard logic.

## Commit

- Planned commit subject: `ci: fetch merge target for getattr guard`
- Required trailer included: `Assisted-by: Codex:GPT-5.4`
