"""DifyBuilder program-counter state machine.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/state.go.

``PcState`` is a program-counter state in the dify_builder state machine. Fix-flow
states are prefixed ``fix.``; checklist states drive the pre-publish-checklist
diagnosis source, which feeds into the same fix.propose/apply/verify/publish
flow. ``build.*``/``edit.*`` are the Build/Edit slices (spec: docs/superpowers
/specs/2026-08-21-dify-builder-full-flow-contract-design.md, §7) — they
reuse this same runner/CAS/handler-registry machinery (scenario-agnostic).
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

    # Build (spec §7.1) — 15 states (BUILD_AWAIT_TESTDATA added post-spec for
    # the testdata-gate slice).
    BUILD_CAPABILITY_CHECK = "build.capability_check"
    BUILD_GOAL_ANALYSIS = "build.goal_analysis"
    BUILD_INITIAL_PLAN = "build.initial_plan"
    BUILD_RESOURCE_RECOMMENDATION = "build.resource_recommendation"
    BUILD_PLAN_APPROVAL = "build.plan_approval"
    BUILD_EXECUTION = "build.execution"
    BUILD_AWAIT_TESTDATA = "build.await_testdata"
    BUILD_TEST_AND_REPAIR = "build.test_and_repair"
    BUILD_AWAIT_REPAIR = "build.await_repair"
    BUILD_REVIEW = "build.review"
    BUILD_PUBLISH = "build.publish"
    BUILD_GOVERNANCE_FEEDBACK = "build.governance_feedback"
    BUILD_AWAIT_LEARNING = "build.await_learning"
    BUILD_COMPLETE = "build.complete"
    BUILD_REVERTED = "build.reverted"

    # Edit (spec §7.2) — 10 states (EDIT_AWAIT_REPAIR added post-spec for the
    # live-test de-canning slice, mirrors BUILD_AWAIT_REPAIR; EDIT_AWAIT_TESTDATA
    # added post-spec for the testdata-gate slice).
    EDIT_CAPABILITY_CHECK = "edit.capability_check"
    EDIT_IMPACT_ANALYSIS = "edit.impact_analysis"
    EDIT_PLAN_APPROVAL = "edit.plan_approval"
    EDIT_APPLY_CHANGES = "edit.apply_changes"
    EDIT_AWAIT_TESTDATA = "edit.await_testdata"
    EDIT_TEST_AFFECTED_PATHS = "edit.test_affected_paths"
    EDIT_AWAIT_REPAIR = "edit.await_repair"
    EDIT_REVIEW = "edit.review"
    EDIT_PUBLISH = "edit.publish"
    EDIT_REVERTED = "edit.reverted"


_WORKING = frozenset(
    {
        PcState.FIX_DIAGNOSE,
        PcState.FIX_PROPOSE,
        PcState.FIX_APPLY,
        PcState.FIX_VERIFY,
        PcState.FIX_PUBLISH,
        PcState.CHECKLIST_DIAGNOSE,
        PcState.CHECKLIST_PROPOSE,
        # Build/Edit: executing/auto-advance, canvas locked (spec §7).
        PcState.BUILD_TEST_AND_REPAIR,
        PcState.BUILD_PUBLISH,
        PcState.BUILD_GOVERNANCE_FEEDBACK,
        PcState.EDIT_TEST_AFFECTED_PATHS,
    }
)

_WAITING = frozenset(
    {
        PcState.FIX_AWAIT_APPROVAL,
        PcState.FIX_AWAIT_VERIFY,
        PcState.FIX_AWAIT_TESTDATA,
        PcState.FIX_AWAIT_DECISION,
        PcState.CHECKLIST_AWAIT_RECHECK,
        # Build/Edit: awaits user, including executing->waiting_confirmation
        # states classified by where they come to rest (spec §7).
        PcState.BUILD_CAPABILITY_CHECK,
        PcState.BUILD_GOAL_ANALYSIS,
        PcState.BUILD_INITIAL_PLAN,
        PcState.BUILD_RESOURCE_RECOMMENDATION,
        PcState.BUILD_PLAN_APPROVAL,
        PcState.BUILD_EXECUTION,
        PcState.BUILD_AWAIT_TESTDATA,
        PcState.BUILD_AWAIT_REPAIR,
        PcState.BUILD_REVIEW,
        PcState.BUILD_AWAIT_LEARNING,
        PcState.BUILD_REVERTED,
        PcState.EDIT_CAPABILITY_CHECK,
        PcState.EDIT_IMPACT_ANALYSIS,
        PcState.EDIT_PLAN_APPROVAL,
        PcState.EDIT_APPLY_CHANGES,
        PcState.EDIT_AWAIT_TESTDATA,
        PcState.EDIT_AWAIT_REPAIR,
        PcState.EDIT_REVIEW,
        PcState.EDIT_REVERTED,
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
    return s in (PcState.SUCCESS, PcState.FAILED, PcState.BUILD_COMPLETE, PcState.EDIT_PUBLISH)


def canvas_read_only(s: PcState) -> bool:
    """Derived lock flag surfaced to the UI."""
    return is_working(s)
