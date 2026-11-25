"""A gate's choice as card options plus one fixed submit button.

The action bar used to change shape per gate -- four buttons at review, one at
plan approval. These project the same choice into the fixed interaction dock.
"""

import pytest

from core.dify_builder.contract import CONFIRM_ACTION_ID, ActionKind, Decision
from core.dify_builder.models import Graph, Run
from core.dify_builder.state import PcState
from services.dify_builder.application.verification import publication_decision
from services.dify_builder.service import (
    _actions_for,
    _decision_for,
    resolve_submitted_action,
)
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, successful_verification


def _decision(state: PcState, *, verified: bool = False) -> Decision | None:
    port = FakeDifyPort()
    run = (
        Run(
            session_id="session",
            dify_run_id="dify-run-1",
            kind="verify",
            status="succeeded",
            immutable=True,
            verification=successful_verification(port),
        )
        if verified
        else None
    )
    publication = publication_decision(
        run, session_id="session", current_revision="h0", current_graph_revision=port.graph_revision(port.graph)
    )
    return _decision_for(state, _actions_for(state, publication=publication))


def test_build_plan_can_be_adjusted_before_approval() -> None:
    decision = _decision(PcState.BUILD_PLAN_APPROVAL)

    assert decision is not None
    assert [o.id for o in decision.options] == ["approve_plan", "continue_adjusting"]
    assert decision.options[0].is_default is True
    assert decision.default_option_id == "approve_plan"
    assert decision.options[1].next_state == "build.goal_analysis"
    assert decision.options[1].tone == "neutral"


@pytest.mark.parametrize(
    "state",
    [
        PcState.FIX_AWAIT_TESTDATA,
        PcState.BUILD_GOAL_ANALYSIS,
        PcState.BUILD_RESOURCE_RECOMMENDATION,
        PcState.BUILD_AWAIT_TESTDATA,
        PcState.EDIT_IMPACT_ANALYSIS,
        PcState.EDIT_AWAIT_TESTDATA,
    ],
)
def test_form_and_resource_gates_do_not_also_project_a_choice(state: PcState) -> None:
    assert _decision(state) is None


def test_an_automatic_action_is_never_offered_as_an_option() -> None:
    from core.dify_builder.contract import Action as UiAction

    decision = _decision_for(
        PcState.BUILD_REVIEW,
        [
            UiAction(id="visible", label="Visible", kind=ActionKind.PRIMARY),
            UiAction(id="auto", label="Auto", kind=ActionKind.AUTOMATIC),
        ],
    )

    assert decision is not None
    assert [o.id for o in decision.options] == ["visible"]


class TestResolvingWhatTheClientPosted:
    @pytest.mark.parametrize("payload", [{}, None, {"option_id": ""}, {"option_id": None}, "not-a-dict"])
    def test_confirm_naming_no_option_resolves_to_nothing(self, payload: Graph | None) -> None:
        # "" is not legal in any state, so the existing per-state check rejects it.
        assert resolve_submitted_action(CONFIRM_ACTION_ID, payload) == ""
