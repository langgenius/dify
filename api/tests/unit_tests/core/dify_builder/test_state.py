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


def test_state_classification():
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


def test_canvas_read_only_matches_is_working():
    for s in ALL_STATES:
        assert canvas_read_only(s) == is_working(s)


def test_state_values_are_verbatim_go_strings():
    assert PcState.FIX_DIAGNOSE == "fix.diagnose"
    assert PcState.FIX_PROPOSE == "fix.propose"
    assert PcState.FIX_AWAIT_APPROVAL == "fix.await_approval"
    assert PcState.FIX_APPLY == "fix.apply"
    assert PcState.FIX_AWAIT_VERIFY == "fix.await_verify"
    assert PcState.FIX_AWAIT_TESTDATA == "fix.await_testdata"
    assert PcState.FIX_VERIFY == "fix.verify"
    assert PcState.FIX_AWAIT_DECISION == "fix.await_decision"
    assert PcState.FIX_PUBLISH == "fix.publish"
    assert PcState.CHECKLIST_DIAGNOSE == "checklist.diagnose"
    assert PcState.CHECKLIST_PROPOSE == "checklist.propose"
    assert PcState.CHECKLIST_AWAIT_RECHECK == "checklist.await_recheck"
    assert PcState.SUCCESS == "success"
    assert PcState.FAILED == "failed"


def test_build_await_learning_is_waiting():
    assert PcState.BUILD_AWAIT_LEARNING == "build.await_learning"
    assert is_waiting(PcState.BUILD_AWAIT_LEARNING) is True
    assert is_working(PcState.BUILD_AWAIT_LEARNING) is False
    assert is_terminal(PcState.BUILD_AWAIT_LEARNING) is False
