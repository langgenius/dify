"""A gate's choice as card options plus one fixed button pair.

The action bar used to change shape per gate -- four buttons at review, one at
plan approval. These project the same choice, identically everywhere.
"""

import pytest

from core.dify_builder.contract import CANCEL_ACTION_ID, CONFIRM_ACTION_ID, ActionKind
from core.dify_builder.state import PcState
from services.dify_builder.service import (
    _actions_for,
    _decision_for,
    resolve_action_kind,
    resolve_submitted_action,
)


def _decision(state: PcState):
    return _decision_for(_actions_for(state))


def test_a_gate_offers_its_actions_as_options_not_buttons():
    decision = _decision(PcState.BUILD_REVIEW)

    assert [o.id for o in decision.options] == [
        "publish_workflow",
        "keep_draft",
        "continue_adjusting",
        "revert",
    ]
    # Whatever the gate, the buttons are the same two.
    assert decision.confirm.id == CONFIRM_ACTION_ID
    assert decision.cancel.id == CANCEL_ACTION_ID


def test_exactly_one_option_carries_the_default_badge():
    decision = _decision(PcState.BUILD_REVIEW)

    defaults = [o.id for o in decision.options if o.is_default]
    assert defaults == ["publish_workflow"]
    assert decision.default_option_id == "publish_workflow"


def test_a_destructive_action_keeps_its_tone_as_an_option():
    decision = _decision(PcState.BUILD_REVIEW)

    tones = {o.id: o.tone for o in decision.options}
    assert tones["revert"] == "destructive"
    assert tones["keep_draft"] == "neutral"


def test_an_option_carries_the_state_map_hints_its_action_had():
    decision = _decision(PcState.BUILD_REVIEW)

    publish = next(o for o in decision.options if o.id == "publish_workflow")
    assert publish.next_state == "build.publish"
    assert publish.canvas_event == "publish_workflow"


def test_a_single_action_gate_still_becomes_an_option():
    decision = _decision(PcState.BUILD_PLAN_APPROVAL)

    assert [o.id for o in decision.options] == ["approve_plan"]
    assert decision.options[0].is_default is True


def test_a_gate_offering_nothing_has_no_decision():
    # Nothing to choose means no card options and no buttons -- not an empty row.
    assert _decision_for([]) is None


def test_rejecting_a_repair_asks_for_a_reason():
    decision = _decision(PcState.FIX_AWAIT_APPROVAL)

    reject = next(o for o in decision.options if o.id == "reject_repair")
    assert reject.input is not None
    assert (reject.input.min_length, reject.input.max_length) == (10, 200)
    assert reject.input.required is True


def test_options_without_free_text_declare_none():
    decision = _decision(PcState.FIX_AWAIT_APPROVAL)

    approve = next(o for o in decision.options if o.id == "approve_plan")
    assert approve.input is None


def test_an_automatic_action_is_never_offered_as_an_option():
    from core.dify_builder.contract import Action as UiAction

    decision = _decision_for(
        [
            UiAction(id="visible", label="Visible", kind=ActionKind.PRIMARY),
            UiAction(id="auto", label="Auto", kind=ActionKind.AUTOMATIC),
        ]
    )

    assert [o.id for o in decision.options] == ["visible"]


def test_only_the_first_primary_is_the_default():
    from core.dify_builder.contract import Action as UiAction

    decision = _decision_for(
        [
            UiAction(id="first", label="First", kind=ActionKind.PRIMARY),
            UiAction(id="second", label="Second", kind=ActionKind.PRIMARY),
        ]
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
