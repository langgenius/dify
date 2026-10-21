"""PRD §9.1 in the Build, Edit and Fix test gates: a side effect runs for real only once confirmed."""

from copy import deepcopy
from datetime import datetime

import pytest
from pytest_mock import MockerFixture

from core.dify_builder.models import (
    Action,
    Actor,
    DifyBuilderContext,
    EntryMode,
    NodeOutput,
    Run,
    RunVerification,
    Session,
    Turn,
)
from core.dify_builder.state import PcState
from runtime_contracts.builder.execution import ExecutionEvidenceSummary
from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.runner import Env
from services.dify_builder.application.verification import publication_decision, result_card
from services.dify_builder.effect_disclosure import confirm_field_key, disclose
from services.dify_builder.serde import context_from_dict, context_to_dict
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, saved_test_context
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

GRAPH = {
    "nodes": [
        {"id": "start", "data": {"type": "start", "title": "Start"}},
        {
            "id": "slack",
            "data": {
                "type": "tool",
                "title": "Notify",
                "provider_id": "langgenius/slack/slack",
                "provider_type": "builtin",
                "tool_name": "send_message",
                "tool_label": "Send message",
                "tool_parameters": {"channel": {"type": "constant", "value": "#ops"}},
            },
        },
        {
            "id": "purge",
            "data": {"type": "http-request", "title": "Purge", "method": "delete", "url": "https://x.io/a"},
        },
    ]
}

# (module, entry mode, rest state, retest action, retest handler, testdata state)
FLOWS = [
    (
        handlers_build,
        EntryMode.BUILD,
        PcState.BUILD_EXECUTION,
        "run_test",
        handlers_build.handle_execution,
        PcState.BUILD_AWAIT_TESTDATA,
    ),
    (
        handlers_edit,
        EntryMode.EDIT,
        PcState.EDIT_APPLY_CHANGES,
        "run_affected_tests",
        handlers_edit.handle_apply_changes,
        PcState.EDIT_AWAIT_TESTDATA,
    ),
    (
        handlers_fix,
        EntryMode.FIX,
        PcState.FIX_AWAIT_VERIFY,
        "run_verify",
        handlers_fix.handle_await_verify,
        PcState.FIX_AWAIT_TESTDATA,
    ),
]
RUN_HANDLERS = {
    handlers_build: handlers_build.handle_test_and_repair,
    handlers_edit: handlers_edit.handle_test_affected_paths,
    handlers_fix: handlers_fix.handle_verify,
}


def _fixture(flow, *, disclosed: bool = True):
    module, mode, state, kind, _handler, _testdata = flow
    dify = FakeDifyPort()
    if disclosed:
        dify.effect_disclosure = disclose(GRAPH, {"slack": "Ops bot"})
    repo = InMemoryRepository()
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min)
    session = Session(id="s", app_id="app", entry_mode=mode, current_state=state)
    turn = Turn(actor=Actor(account_id="a", tenant_id="t"), action=Action(kind=kind))
    return module, dify, repo, env, session, turn


def _signature(node_id: str) -> str:
    return next(item.signature for item in disclose(GRAPH, {"slack": "Ops bot"}).items if item.node_id == node_id)


@pytest.mark.parametrize("flow", FLOWS)
def test_run_test_shows_the_form_again_while_a_side_effect_is_unconfirmed(flow):
    module, _dify, repo, env, session, turn = _fixture(flow)
    fc = saved_test_context(repo, session.id)

    result = flow[4](env, turn, session, fc)

    assert result.next == flow[5]
    form = next(item.payload for item in result.items if item.kind == "form")
    confirm = [f for f in form["fields"] if f["key"] == confirm_field_key("slack")]
    assert len(confirm) == 1
    assert confirm[0]["type"] == "checkbox"
    assert "Ops bot" in english_text(confirm[0]["hint"])
    assert form["values"][confirm_field_key("slack")] is False
    # Destructive steps are never offered: they are always mocked.
    assert confirm_field_key("purge") not in {f["key"] for f in form["fields"]}
    reply = next(english_text(item.payload["reply_text"]) for item in result.items if item.kind == "assistant_turn")
    assert "Purge" in reply
    assert "tick them in the form" in reply


@pytest.mark.parametrize("flow", FLOWS)
def test_explicit_run_requires_a_fresh_confirmation_even_after_a_previous_approval(flow):
    module, _dify, repo, env, session, turn = _fixture(flow)
    fc = saved_test_context(repo, session.id, effect_confirmation={"slack": _signature("slack")})

    result = flow[4](env, turn, session, fc)

    assert result.next == flow[5]
    form = next(item.payload for item in result.items if item.kind == "form")
    assert form["values"][confirm_field_key("slack")] is False


@pytest.mark.parametrize("flow", FLOWS)
def test_nothing_to_disclose_keeps_the_existing_gate(flow):
    module, _dify, repo, env, session, turn = _fixture(flow, disclosed=False)

    result = flow[4](env, turn, session, saved_test_context(repo, session.id))

    assert result.next != flow[5]


@pytest.mark.parametrize("flow", FLOWS)
def test_ticked_box_is_recorded_and_kept_out_of_the_start_inputs(mocker: MockerFixture, flow):
    module, dify, repo, env, session, _turn = _fixture(flow)
    turn = Turn(
        actor=Actor(account_id="a", tenant_id="t"),
        action=Action(
            kind="submit_testdata",
            payload={"mode": "upload", "inputs": {confirm_field_key("slack"): True, confirm_field_key("purge"): True}},
        ),
    )
    fc = DifyBuilderContext()
    flow[4](env, _turn, session, fc)

    result = module.handle_await_testdata(env, turn, session, fc)

    assert result.context.effect_confirmation == {"slack": _signature("slack")}
    assert repo.get_test_input(result.context.test_input_ref).inputs == {}

    mocker.patch.object(dify, "run_draft", return_value=Run(status="succeeded"))
    RUN_HANDLERS[module](env, turn, session, result.context)
    assert dify.run_draft.call_args.kwargs["effect_confirmation"] == {"slack": _signature("slack")}


@pytest.mark.parametrize("flow", FLOWS)
@pytest.mark.parametrize("change", ["endpoint", "headers", "account", "credential"])
def test_old_checkbox_redisplays_changed_targets_instead_of_confirming_them(flow, change):
    module, dify, _repo, env, session, turn = _fixture(flow)
    graph = deepcopy(GRAPH)
    graph["nodes"].append(
        {
            "id": "hook",
            "data": {"type": "http-request", "method": "post", "url": "https://x.io/a", "headers": "X-Tenant: a"},
        }
    )
    dify.effect_disclosure = disclose(graph, {"slack": "Ops bot"}, account_bindings={"slack": "credential-a"})
    fc = DifyBuilderContext()
    flow[4](env, turn, session, fc)
    fc = context_from_dict(context_to_dict(fc))
    if change == "endpoint":
        graph["nodes"][-1]["data"]["url"] = "https://x.io/b"
    elif change == "headers":
        graph["nodes"][-1]["data"]["headers"] = "X-Tenant: b"
    dify.effect_disclosure = disclose(
        graph,
        {"slack": "Other bot" if change == "account" else "Ops bot"},
        account_bindings={"slack": "credential-b" if change == "credential" else "credential-a"},
    )
    turn.action = Action(
        kind="provide_testdata", payload={"inputs": {confirm_field_key("slack"): True, confirm_field_key("hook"): True}}
    )

    result = module.handle_await_testdata(env, turn, session, fc)

    assert result.next == flow[5]
    form = next(item.payload for item in result.items if item.kind == "form")
    changed_node = "slack" if change in {"account", "credential"} else "hook"
    assert form["values"][confirm_field_key(changed_node)] is False
    assert changed_node not in result.context.effect_confirmation
    assert not result.context.test_input_ref
    unchanged_node = "hook" if changed_node == "slack" else "slack"
    assert form["values"][confirm_field_key(unchanged_node)] is True

    reviewed = module.handle_await_testdata(env, turn, session, result.context)

    assert reviewed.next != flow[5]
    assert set(reviewed.context.effect_confirmation) == {"slack", "hook"}


@pytest.mark.parametrize("flow", FLOWS)
def test_checkbox_without_a_server_shown_disclosure_cannot_confirm_an_effect(flow):
    module, _dify, _repo, env, session, turn = _fixture(flow)
    turn.action = Action(kind="provide_testdata", payload={"inputs": {confirm_field_key("slack"): True}})

    result = module.handle_await_testdata(env, turn, session, DifyBuilderContext())

    assert result.next == flow[5]
    assert result.context.effect_confirmation == {}


@pytest.mark.parametrize("flow", FLOWS)
def test_user_entered_start_target_is_bound_without_rejecting_an_intentional_input_edit(flow, monkeypatch):
    module, dify, repo, env, session, turn = _fixture(flow)
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start"}},
            {"id": "hook", "data": {"type": "http-request", "method": "post", "url": "https://{{#start.host#}}/items"}},
        ]
    }

    def disclosure(_app_id, _actor, *, inputs=None):
        return disclose(graph, inputs=inputs)

    monkeypatch.setattr(dify, "disclose_effects", disclosure)
    fc = DifyBuilderContext()
    flow[4](env, turn, session, fc)
    turn.action = Action(
        kind="provide_testdata", payload={"inputs": {"host": "a.example.com", confirm_field_key("hook"): True}}
    )

    result = module.handle_await_testdata(env, turn, session, fc)

    assert result.next != flow[5]
    assert repo.get_test_input(result.context.test_input_ref).inputs == {"host": "a.example.com"}
    assert disclose(graph, inputs={"host": "a.example.com"}).mocked_node_ids(fc.effect_confirmation) == set()
    assert disclose(graph, inputs={"host": "b.example.com"}).mocked_node_ids(fc.effect_confirmation) == {"hook"}


def _confirmed_run(simulated: tuple[str, ...]) -> Run:
    return Run(
        id="run",
        session_id="s",
        kind="verify",
        immutable=True,
        status="succeeded",
        dify_run_id="native-1",
        per_node=[NodeOutput(node_id="slack", title="Notify", status="succeeded")],
        verification=RunVerification(
            execution_evidence=ExecutionEvidenceSummary(
                request_id="request-1",
                policy_version="builder-confirmed-run-v1",
                mode="confirmed_run",
                sealed=True,
                safety_outcome="confirmed_run_completed",
                sandbox_profile="native",
                native_run_id="native-1",
                simulated_node_ids=simulated,
            ),
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs={},
            output_findings=[],
            executed_node_ids=["start", "slack"],
            no_output_dead_branch=False,
        ),
    )


def test_a_fully_confirmed_run_can_be_published():
    decision = publication_decision(
        _confirmed_run(()), session_id="s", current_revision="rev", current_graph_revision="graph"
    )

    assert decision.allowed is True


def test_a_run_with_mocked_steps_cannot_be_published_and_says_which():
    run = _confirmed_run(("slack",))

    decision = publication_decision(run, session_id="s", current_revision="rev", current_graph_revision="graph")
    card = result_card(run)

    assert (decision.allowed, decision.reason) == (False, "simulation_only")
    assert card.outcome == "execution_succeeded_needs_review"
    assert card.simulated_node_ids == ["slack"]
    assert "These steps used mocked results: Notify." in english_text(card.review_note)
