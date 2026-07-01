# HITL timeout semantics implementation report

## What changed

- Updated `api/core/workflow/nodes/human_input/callback.py` so `DifyHITLCallback` now preserves Dify's timeout split at the boundary:
  - `HumanInputFormStatus.TIMEOUT` returns the graphon timeout branch via `Expired(selected_handle="__timeout__", ...)`.
  - `HumanInputFormStatus.EXPIRED` is treated as an invalid resume state and raises `AssertionError`.
  - `HumanInputFormStatus.WAITING` with a past global deadline is treated as an invalid resume state and raises `AssertionError`.
  - `HumanInputFormStatus.WAITING` with only the node-level deadline expired still returns the timeout branch.
- Added `created_at` to `HumanInputFormEntity` and `_HumanInputFormEntityImpl` so the callback can compute the global deadline using Dify's shared `HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS` invariant.
- Kept the submitted and pause flows unchanged.
- Added focused unit coverage in `api/tests/unit_tests/core/workflow/test_human_input_callback.py` for:
  - node timeout branch
  - global expiration rejection
  - waiting-form past node deadline timeout
  - waiting-form past global deadline rejection

## Verification

- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_human_input_callback.py api/tests/unit_tests/core/workflow/nodes/human_input/test_human_input_form_filled_event.py -q`
- `git diff --check`

## Result

- The focused test set is expected to pass with the new `created_at` boundary in place.
- No unrelated files were modified.

## Concerns

- The callback now fails fast on invalid resume states by design. That is intentional, but any caller that previously relied on `EXPIRED` being mapped to the timeout branch will now see an assertion failure instead.
