"""A gate's choice as card options plus one fixed submit button.

The action bar used to change shape per gate -- four buttons at review, one at
plan approval. These project the same choice into the fixed interaction dock.
"""

import pytest

from core.dify_builder.contract import CONFIRM_ACTION_ID, ActionKind
from core.dify_builder.models import DifyBuilderContext, MutationIntent, Run
from core.dify_builder.state import PcState
from core.dify_builder.verification import publication_decision
from services.dify_builder.service import (
    _actions_for,
    _decision_for,
    resolve_action_kind,
    resolve_submitted_action,
)
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, successful_verification


def _decision(state: PcState, *, verified: bool = False):
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


@pytest.mark.parametrize("verified", [True, False])
def test_a_gate_offers_its_actions_as_options_not_buttons(verified: bool):
    decision = _decision(PcState.BUILD_REVIEW, verified=verified)

    assert [o.id for o in decision.options] == [
        "publish_workflow" if verified else "run_test",
        "keep_draft",
        "continue_adjusting",
        "revert",
    ]
    assert decision.submit is not None
    assert decision.submit.id == CONFIRM_ACTION_ID
    assert decision.submit.label == "Submit"


@pytest.mark.parametrize("verified", [True, False])
def test_exactly_one_option_carries_the_default_badge(verified: bool):
    decision = _decision(PcState.BUILD_REVIEW, verified=verified)

    defaults = [o.id for o in decision.options if o.is_default]
    expected_default = "publish_workflow" if verified else "run_test"
    assert defaults == [expected_default]
    assert decision.default_option_id == expected_default


def test_a_destructive_action_keeps_its_tone_as_an_option():
    decision = _decision(PcState.BUILD_REVIEW)

    tones = {o.id: o.tone for o in decision.options}
    assert tones["revert"] == "destructive"
    assert tones["keep_draft"] == "neutral"


@pytest.mark.parametrize("verified", [True, False])
def test_an_option_carries_the_state_map_hints_its_action_had(verified: bool):
    decision = _decision(PcState.BUILD_REVIEW, verified=verified)

    option_id = "publish_workflow" if verified else "run_test"
    option = next(o for o in decision.options if o.id == option_id)
    assert option.next_state == ("build.publish" if verified else None)
    assert option.canvas_event == ("publish_workflow" if verified else None)


def test_a_single_action_gate_still_becomes_an_option():
    decision = _decision(PcState.BUILD_PLAN_APPROVAL)

    assert [o.id for o in decision.options] == ["approve_plan"]
    assert decision.options[0].is_default is True


def test_a_gate_offering_nothing_has_no_decision():
    # Nothing to choose means no card options and no button -- not an empty dock.
    assert _decision_for(PcState.BUILD_REVIEW, []) is None


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
def test_form_and_resource_gates_do_not_also_project_a_choice(state: PcState):
    assert _decision(state) is None


def test_rejecting_a_repair_asks_for_a_reason():
    decision = _decision(PcState.FIX_AWAIT_APPROVAL)

    reject = next(o for o in decision.options if o.id == "reject_repair")
    assert reject.input is not None
    assert (reject.input.min_length, reject.input.max_length) == (10, 200)
    assert reject.input.required is True


def test_options_without_free_text_declare_none():
    state = PcState.FIX_AWAIT_APPROVAL
    context = DifyBuilderContext(
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "title", "value": "Fixed"})]
    )
    decision = _decision_for(state, _actions_for(state, context))

    approve = next(o for o in decision.options if o.id == "approve_plan")
    assert approve.input is None


def test_an_automatic_action_is_never_offered_as_an_option():
    from core.dify_builder.contract import Action as UiAction

    decision = _decision_for(
        PcState.BUILD_REVIEW,
        [
            UiAction(id="visible", label="Visible", kind=ActionKind.PRIMARY),
            UiAction(id="auto", label="Auto", kind=ActionKind.AUTOMATIC),
        ],
    )

    assert [o.id for o in decision.options] == ["visible"]


def test_only_the_first_primary_is_the_default():
    from core.dify_builder.contract import Action as UiAction

    decision = _decision_for(
        PcState.BUILD_REVIEW,
        [
            UiAction(id="first", label="First", kind=ActionKind.PRIMARY),
            UiAction(id="second", label="Second", kind=ActionKind.PRIMARY),
        ],
    )

    # Two recommendations is no recommendation.
    assert [o.id for o in decision.options if o.is_default] == ["first"]


class TestResolvingWhatTheClientPosted:
    def test_confirm_resolves_through_the_named_option(self):
        # "publish_fix" is renamed to the handler kind "publish"; the option id
        # goes through exactly the map the button id used to.
        assert resolve_submitted_action(CONFIRM_ACTION_ID, {"option_id": "publish_fix"}) == "publish"

    def test_an_option_id_that_is_already_a_kind_passes_through(self):
        assert resolve_submitted_action(CONFIRM_ACTION_ID, {"option_id": "publish_workflow"}) == "publish_workflow"

    def test_a_legacy_client_posting_the_action_id_still_resolves(self):
        assert resolve_submitted_action("publish_fix", {}) == "publish"

    def test_both_contracts_land_on_the_same_kind(self):
        for action_id in ("publish_fix", "run_validation", "revert", "restart"):
            assert resolve_submitted_action(CONFIRM_ACTION_ID, {"option_id": action_id}) == resolve_action_kind(
                action_id
            )

    @pytest.mark.parametrize("payload", [{}, None, {"option_id": ""}, {"option_id": None}, "not-a-dict"])
    def test_confirm_naming_no_option_resolves_to_nothing(self, payload):
        # "" is not legal in any state, so the existing per-state check rejects it.
        assert resolve_submitted_action(CONFIRM_ACTION_ID, payload) == ""
