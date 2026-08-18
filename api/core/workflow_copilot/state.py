"""Copilot program-counter state machine.

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/state.go.

``PcState`` is a program-counter state in the copilot state machine. Fix-flow
states are prefixed ``fix.``; checklist states drive the pre-publish-checklist
diagnosis source, which feeds into the same fix.propose/apply/verify/publish
flow. Future Build/Edit slices add their own sets.
"""

from enum import StrEnum


class PcState(StrEnum):
    FIX_DIAGNOSE = "fix.diagnose"
    FIX_PROPOSE = "fix.propose"
    FIX_AWAIT_APPROVAL = "fix.await_approval"
    FIX_APPLY = "fix.apply"
    FIX_AWAIT_VERIFY = "fix.await_verify"
    FIX_AWAIT_TESTDATA = "fix.await_testdata"
    FIX_VERIFY = "fix.verify"
    FIX_AWAIT_DECISION = "fix.await_decision"
    FIX_PUBLISH = "fix.publish"

    CHECKLIST_DIAGNOSE = "checklist.diagnose"
    CHECKLIST_PROPOSE = "checklist.propose"
    CHECKLIST_AWAIT_RECHECK = "checklist.await_recheck"

    SUCCESS = "success"
    FAILED = "failed"


_WORKING = frozenset(
    {
        PcState.FIX_DIAGNOSE,
        PcState.FIX_PROPOSE,
        PcState.FIX_APPLY,
        PcState.FIX_VERIFY,
        PcState.FIX_PUBLISH,
        PcState.CHECKLIST_DIAGNOSE,
        PcState.CHECKLIST_PROPOSE,
    }
)

_WAITING = frozenset(
    {
        PcState.FIX_AWAIT_APPROVAL,
        PcState.FIX_AWAIT_VERIFY,
        PcState.FIX_AWAIT_TESTDATA,
        PcState.FIX_AWAIT_DECISION,
        PcState.CHECKLIST_AWAIT_RECHECK,
    }
)


def is_working(s: PcState) -> bool:
    """Report whether the agent/system is acting; the canvas is LOCKED."""
    return s in _WORKING


def is_waiting(s: PcState) -> bool:
    """Report whether the machine awaits user input; the canvas is EDITABLE."""
    return s in _WAITING


def is_terminal(s: PcState) -> bool:
    """Report whether the task is finished."""
    return s in (PcState.SUCCESS, PcState.FAILED)


def canvas_read_only(s: PcState) -> bool:
    """Derived lock flag surfaced to the UI."""
    return is_working(s)
