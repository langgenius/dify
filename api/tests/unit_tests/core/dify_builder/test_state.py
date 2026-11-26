"""Port of state_test.go::TestStateClassification.

Mirrors the Go test in dify-enterprise/server/pkg/enterprise/biz/dify_builder/state_test.go:
asserts the classification of each known PcState and that working/waiting/terminal
form a total, mutually-exclusive partition over the fix.* + checklist.* + terminal set.
"""

from core.dify_builder.state import (
    PcState,
    canvas_read_only,
    is_terminal,
    is_waiting,
    is_working,
)

ALL_STATES = [
    PcState.FIX_DIAGNOSE,
    PcState.FIX_PROPOSE,
    PcState.FIX_AWAIT_APPROVAL,
    PcState.FIX_APPLY,
    PcState.FIX_AWAIT_VERIFY,
    PcState.FIX_AWAIT_TESTDATA,
    PcState.FIX_VERIFY,
    PcState.FIX_AWAIT_DECISION,
    PcState.FIX_PUBLISH,
    PcState.SUCCESS,
    PcState.FAILED,
    PcState.CHECKLIST_DIAGNOSE,
    PcState.CHECKLIST_PROPOSE,
    PcState.CHECKLIST_AWAIT_RECHECK,
]


def test_state_classification() -> None:
    assert is_working(PcState.FIX_DIAGNOSE)
    assert is_working(PcState.FIX_APPLY)
    assert is_working(PcState.FIX_VERIFY)
    assert not is_working(PcState.FIX_AWAIT_VERIFY)

    assert is_waiting(PcState.FIX_AWAIT_APPROVAL)
    assert is_waiting(PcState.FIX_AWAIT_DECISION)
    assert not is_waiting(PcState.FIX_DIAGNOSE)

    assert is_terminal(PcState.SUCCESS)
    assert is_terminal(PcState.FAILED)
    assert not is_terminal(PcState.FIX_PUBLISH)

    assert is_working(PcState.CHECKLIST_DIAGNOSE)
    assert is_working(PcState.CHECKLIST_PROPOSE)
    assert not is_working(PcState.CHECKLIST_AWAIT_RECHECK)
    assert is_waiting(PcState.CHECKLIST_AWAIT_RECHECK)
    assert not is_waiting(PcState.CHECKLIST_DIAGNOSE)

    # mutually exclusive, total over the FIX_* + CHECKLIST_* + terminal set
    for s in ALL_STATES:
        n = 0
        if is_working(s):
            n += 1
        if is_waiting(s):
            n += 1
        if is_terminal(s):
            n += 1
        assert n == 1, f"state {s} must be exactly one of working/waiting/terminal"


def test_canvas_read_only_matches_is_working() -> None:
    for s in ALL_STATES:
        assert canvas_read_only(s) == is_working(s)


def test_build_initial_plan_is_working_not_waiting() -> None:
    """build.initial_plan is reachable only via the continue_adjusting/
    retry_after_revert loop-back, where it runs resource discovery
    unconditionally and falls straight through to
    build.resource_recommendation -- a pass-through step, not a state a user
    waits at. It must classify as working (canvas locked, runner drives it
    unconditionally on entry, no _ACTIONS_FOR/_BACKEND_ACTIONS_FOR entry), not
    waiting -- else the runner's `is_waiting(next_state)` settle check would
    stop the advance loop there with no action to ever move it forward."""
    assert PcState.BUILD_INITIAL_PLAN == "build.initial_plan"
    assert is_working(PcState.BUILD_INITIAL_PLAN) is True
    assert is_waiting(PcState.BUILD_INITIAL_PLAN) is False
    assert is_terminal(PcState.BUILD_INITIAL_PLAN) is False
    assert canvas_read_only(PcState.BUILD_INITIAL_PLAN) is True
