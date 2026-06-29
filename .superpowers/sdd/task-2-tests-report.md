# Task 2 RED Test Report

## Scope

- Added focused RED tests for the graphon-185 HITL callback contract:
  - `api/tests/unit_tests/core/workflow/human_input/test_callback.py`
- Updated human-input node factory wiring assertions:
  - `api/tests/unit_tests/core/workflow/test_node_factory.py`

No production files were edited.

## What The New Tests Pin

### HITL callback contract

`api/tests/unit_tests/core/workflow/human_input/test_callback.py` expects a Dify-owned callback module at
`core.workflow.human_input.callback` that exposes a callback entrypoint and supports:

1. First pause:
   - create a form
   - persist `workflow_execution_id`, `node_id`, rendered content, and resolved defaults
   - return graphon `PauseRequested(session_id=...)`
2. Submitted form:
   - return `Completed(...)`
   - preserve selected handle
   - restore submitted inputs/outputs
   - rebuild `__action_id` and `__rendered_content`
3. Timed out / expired form:
   - return `Expired(...)`
   - preserve timeout branch selection
4. Waiting form:
   - re-return `PauseRequested(...)`
   - avoid creating a duplicate form

### Node factory wiring

`api/tests/unit_tests/core/workflow/test_node_factory.py` now expects
`BuiltinNodeTypes.HUMAN_INPUT` construction to pass:

- `hitl_callback`

and to stop passing:

- `runtime`
- `form_repository`
- `file_reference_factory`

## Verification

Ran:

```bash
uv run --project api pytest -o addopts='' \
  api/tests/unit_tests/core/workflow/human_input/test_callback.py \
  api/tests/unit_tests/core/workflow/test_node_factory.py
```

Result:

- 7 failed
- 52 passed

## Observed RED Failures

1. Callback module missing:
   - All 5 tests in `api/tests/unit_tests/core/workflow/human_input/test_callback.py`
   - Current failure:
     - `No module named 'core.workflow.human_input.callback'`

2. Node factory still uses old human-input wiring:
   - `TestDifyNodeFactoryCreateNode::test_creates_specialized_nodes[human-input-HumanInputNode]`
   - `TestDifyNodeFactoryCreateNode::test_human_input_node_receives_hitl_callback_only`
   - Current failure:
     - constructor kwargs do not include `hitl_callback`
     - old `runtime` / `form_repository` path is still active

## Notes

- I removed one unrelated init-test noise source so the remaining failures stay focused on the callback migration.
- The callback tests are intentionally narrow: they do not add generic import-failure coverage outside the new callback entrypoint and graphon-185 HITL contract.
