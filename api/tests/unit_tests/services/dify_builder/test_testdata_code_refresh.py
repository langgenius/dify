"""Initial file input refreshes low-risk Code facts without transferring consent."""

import json
from datetime import datetime

import pytest

from core.dify_builder.models import Action, Actor, DifyBuilderContext, Session, Turn
from models.model import AppMode
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder import code_risk_assessment
from services.dify_builder.application.handlers_fix import testdata_form as make_testdata_form
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.runner import Env
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.effect_disclosure import confirm_field_key
from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository
from tests.unit_tests.core.dify_builder.test_effect_confirmation_gate import FLOWS, Flow
from tests.unit_tests.services.dify_builder.test_code_risk_assessment import graph
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import FullRunCase
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as _full_run_harness

harness = _full_run_harness


def _initial_form(
    h: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int, classifications: list[str]
) -> tuple[Flow, Env, Session, DifyBuilderContext, Turn, list[dict[str, object]]]:
    flow = FLOWS[flow_index]
    g = graph("def main(value):\n    return {'result': value}", selector=["extract", "text"])
    g["nodes"][0]["data"]["variables"] = [
        {"variable": "order_file", "type": "file", "required": False},
        {"variable": "file_list", "type": "file-list", "required": False, "max_length": 1},
        {"variable": "note", "type": "paragraph", "required": False, "max_length": 8},
    ]
    g["nodes"].append({"id": "extract", "data": {"type": "document-extractor"}})
    h.draft.graph = json.dumps(g)
    calls: list[dict[str, object]] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        classification = classifications[min(len(calls), len(classifications) - 1)]
        calls.append(facts)
        if classification == "unavailable":
            raise ValueError("Assessor unavailable")
        return {"classification": classification, "risk_notice": "Current source and typed input risk"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    actor = Actor(account_id=h.ids["account"], tenant_id=h.ids["tenant"])
    session = Session(id=h.ids["session"], app_id=h.ids["app"], entry_mode=flow[1], current_state=flow[5])
    fc = DifyBuilderContext(goal_text="Parse uploaded order data", model_config={"name": "chosen"})
    repo = InMemoryRepository()
    env = Env(dify=WorkflowServiceDifyPort(), agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min)
    _graph, fc.last_snapshot_hash = env.dify.read_graph(session.app_id, actor)
    make_testdata_form(env, session, fc, actor, {}, {}, "Review input and source risk")
    inputs = {
        "order_file": {
            "type": "document",
            "transfer_method": "local_file",
            "upload_file_id": "00000000-0000-4000-8000-000000000001",
        }
    }
    turn = Turn(actor=actor, action=Action(kind="provide_testdata", payload={"mode": "provide", "inputs": inputs}))
    return flow, env, session, fc, turn, calls


@pytest.mark.parametrize("flow_index", [0, 1, 2])
@pytest.mark.parametrize("classification", ["pure", "read"])
def test_initial_file_submission_refreshes_low_risk_code_and_saves_inputs_once(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int, classification: str
) -> None:
    flow, env, session, fc, turn, calls = _initial_form(harness, monkeypatch, flow_index, [classification])
    initial_digest = fc.code_risk_assessments["code"]["facts_digest"]

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next != flow[5]
    assert len(calls) == 2
    assert fc.code_risk_assessments["code"]["facts_digest"] != initial_digest
    assert turn.action is not None
    assert env.repo.get_test_input(fc.test_input_ref).inputs == turn.action.payload["inputs"]
    assert fc.effect_confirmation == {}
    assert not any(item.kind == "form" for item in result.items)
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
@pytest.mark.parametrize("classification", ["side_effect", "destructive", "unknown", "unavailable"])
def test_new_code_risk_requires_fresh_disclosure_without_saving_or_dispatching(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int, classification: str
) -> None:
    flow, env, session, fc, turn, calls = _initial_form(harness, monkeypatch, flow_index, ["pure", classification])

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    assert len(calls) == 2
    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    form = next(item.payload for item in result.items if item.kind == "form")
    assert turn.action is not None
    assert form["values"]["order_file"] == turn.action.payload["inputs"]["order_file"]
    if classification in {"side_effect", "unknown"}:
        assert form["values"][confirm_field_key("code")] is False
    reply = json.dumps([item.payload for item in result.items if item.kind == "assistant_turn"])
    assert "test.policyReview" in reply
    assert "test.effectsChanged" not in reply
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
def test_prior_effect_approval_prevents_automatic_code_scope_refresh(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int
) -> None:
    flow, env, session, fc, turn, calls = _initial_form(harness, monkeypatch, flow_index, ["pure"])
    fc.effect_confirmation = {"previous-effect": "old-scope"}

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    # The next form may prepare the new scope, but the submitted command did
    # not inherit prior consent or proceed to the Run state.
    assert len(calls) == 2
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
def test_selected_code_checkbox_for_changed_input_still_requires_fresh_consent(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int
) -> None:
    flow, env, session, fc, turn, calls = _initial_form(harness, monkeypatch, flow_index, ["side_effect"])
    assert turn.action is not None
    turn.action.payload["inputs"][confirm_field_key("code")] = True

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    assert len(calls) == 2
    form = next(item.payload for item in result.items if item.kind == "form")
    assert form["values"][confirm_field_key("code")] is False
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
def test_initial_input_refresh_cannot_silently_accept_a_changed_pure_code_draft(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int
) -> None:
    flow, env, session, fc, turn, _calls = _initial_form(harness, monkeypatch, flow_index, ["pure"])
    changed = json.loads(harness.draft.graph)
    changed["nodes"][1]["data"]["code"] = "def main(value):\n    return {'different_result': value}"
    harness.draft.graph = json.dumps(changed)

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
def test_initial_code_refresh_rechecks_session_owner_permission(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int
) -> None:
    flow, env, session, fc, turn, _calls = _initial_form(harness, monkeypatch, flow_index, ["pure"])
    turn.actor = Actor(account_id="another-account", tenant_id=turn.actor.tenant_id)

    with pytest.raises(BuilderExecutionPolicyError, match="execution_owner_mismatch"):
        flow[0].handle_await_testdata(env, turn, session, fc)

    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
def test_draft_change_during_code_reasoning_returns_to_form_without_dispatch(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int
) -> None:
    flow, env, session, fc, turn, _calls = _initial_form(harness, monkeypatch, flow_index, ["pure"])

    def reason(_facts: dict[str, object]) -> dict[str, str]:
        changed = json.loads(harness.draft.graph)
        changed["nodes"][1]["data"]["code"] = "def main(value):\n    return {'changed': value}"
        harness.draft.graph = json.dumps(changed)
        return {"classification": "pure", "risk_notice": "Only parses input"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    reply = json.dumps([item.payload for item in result.items if item.kind == "assistant_turn"])
    assert "test.contextChanged" in reply
    harness.generate.assert_not_called()


@pytest.mark.parametrize("flow_index", [0, 1, 2])
@pytest.mark.parametrize("invalid", ["text_type", "text_size", "file_type", "file_list_type", "file_count", "query"])
def test_invalid_submitted_inputs_are_not_assessed_even_when_the_form_is_regenerated(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, flow_index: int, invalid: str
) -> None:
    flow, env, session, fc, turn, calls = _initial_form(harness, monkeypatch, flow_index, ["pure"])
    assert turn.action is not None
    inputs = turn.action.payload["inputs"]
    if invalid == "text_type":
        inputs["note"] = {"not": "text"}
    elif invalid == "text_size":
        inputs["note"] = "oversized note"
    elif invalid == "file_type":
        inputs["order_file"] = "not-a-file"
    elif invalid == "file_list_type":
        inputs["file_list"] = "not-a-file-list"
    elif invalid == "file_count":
        inputs["file_list"] = [inputs["order_file"], inputs["order_file"]]
    else:
        harness.app.mode = AppMode.ADVANCED_CHAT
        inputs["sys.query"] = "   "

    result = flow[0].handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    assert fc.test_input_ref == ""
    assert fc.effect_confirmation == {}
    assert len(calls) == 1
    form = next(item.payload for item in result.items if item.kind == "form")
    assert all(form["values"][key] == value for key, value in inputs.items())
    reply = json.dumps([item.payload for item in result.items if item.kind == "assistant_turn"])
    assert "test.invalidInputs" in reply
    assert any(fragment in reply for fragment in ["must be", "less than", "query is required"])
    harness.generate.assert_not_called()
