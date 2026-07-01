# HITL timeout semantics implementation report

## What changed

- Updated `api/core/workflow/nodes/human_input/callback.py` so `DifyHITLCallback` now preserves Dify's timeout split at the boundary:
  - `HumanInputFormStatus.TIMEOUT` returns the graphon timeout branch via `Expired(selected_handle="__timeout__", ...)`.
  - `HumanInputFormStatus.EXPIRED` is treated as an invalid resume state and raises `AssertionError`.
  - `HumanInputFormStatus.WAITING` with a past deadline is also treated as an invalid resume state and raises `AssertionError`.
- Kept the submitted and pause flows unchanged.
- Added focused unit coverage in `api/tests/unit_tests/core/workflow/test_human_input_callback.py` for:
  - node timeout branch
  - global expiration rejection
  - waiting-form past-deadline rejection

## Verification

- `uv run --project api pytest -o addopts='' api/tests/unit_tests/core/workflow/test_human_input_callback.py api/tests/unit_tests/core/workflow/nodes/human_input/test_human_input_form_filled_event.py -q`
- `git diff --check`

## Result

- The focused test set passed: `8 passed`.
- No unrelated files were modified.

## Concerns

- The callback now fails fast on invalid resume states by design. That is intentional, but any caller that previously relied on `EXPIRED` being mapped to the timeout branch will now see an assertion failure instead.
