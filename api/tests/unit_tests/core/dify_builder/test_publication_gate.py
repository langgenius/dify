from datetime import datetime
from unittest.mock import Mock

import pytest

from core.dify_builder import handlers_build, handlers_edit, handlers_fix
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Run, RunVerification, Session, Turn
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import (
    FakeDifyPort,
    InMemoryRepository,
    failed_verification,
    saved_test_context,
    successful_verification,
)

FLOWS = [
    (handlers_build, EntryMode.BUILD, PcState.BUILD_REVIEW, "publish_workflow", "run_test"),
    (handlers_edit, EntryMode.EDIT, PcState.EDIT_REVIEW, "publish_workflow", "run_affected_tests"),
    (handlers_fix, EntryMode.FIX, PcState.FIX_AWAIT_DECISION, "publish", "run_verify"),
]


def fixture(flow):
    module, mode, state, kind, retest = flow
    dify = FakeDifyPort()
    repo = InMemoryRepository()
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min)
    session = Session(id="s", app_id="app", entry_mode=mode, current_state=state)
    return module, dify, repo, env, session, Turn(actor=Actor(account_id="a", tenant_id="t"), action=Action(kind=kind))


@pytest.mark.parametrize("flow", FLOWS)
@pytest.mark.parametrize("status", ["failed", "running", "legacy", "foreign", "stale", "missing"])
def test_publish_verification_direct_boundaries(flow, status):
    module, dify, repo, env, s, turn = fixture(flow)
    run = Run(
        id="latest",
        session_id="foreign" if status == "foreign" else s.id,
        kind="verify",
        immutable=True,
        status=status if status in {"failed", "running"} else "succeeded",
    )
    if status not in {"legacy", "missing"}:
        run.verification = RunVerification(
            execution_revision="old" if status == "stale" else dify.hash,
            executed_graph_revision="graph",
            terminal_outputs={},
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
        )
    if status != "missing":
        repo.save_run(run.session_id, run)
    fc = DifyBuilderContext(verify_run_id=run.id)
    decision = getattr(module, "handle_review", None) or module.handle_await_decision
    assert decision(env, turn, s, fc).next == s.current_state
    assert module.handle_publish(env, turn, s, fc).next == s.current_state
    assert not dify.published


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_retest_route_clears_previous(flow):
    module, dify, repo, env, s, turn = fixture(flow)
    turn.action.kind = flow[4]
    fc = DifyBuilderContext(verify_run_id="old")
    decision = getattr(module, "handle_review", None) or module.handle_await_decision
    result = decision(env, turn, s, fc)
    assert result.context.verify_run_id == ""
    assert result.next in {PcState.BUILD_AWAIT_TESTDATA, PcState.EDIT_AWAIT_TESTDATA, PcState.FIX_AWAIT_TESTDATA}


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_latest_attempt_and_truthful_outputs(flow):
    module, dify, repo, env, s, turn = fixture(flow)
    evidence = RunVerification(
        execution_evidence=successful_verification(dify).execution_evidence,
        execution_revision=dify.hash,
        executed_graph_revision="graph",
        terminal_outputs={"result": None, "zero": 0, "false": False},
        output_findings=[],
        executed_node_ids=["end"],
        no_output_dead_branch=False,
    )
    dify.run_draft = Mock(return_value=Run(status="succeeded", verification=evidence))
    handler = (
        getattr(module, "handle_test_and_repair", None)
        or getattr(module, "handle_test_affected_paths", None)
        or module.handle_verify
    )
    fc = saved_test_context(env.repo, s.id)
    first = handler(env, turn, s, fc)
    assert first.context.verify_run_id == first.run.id
    assert first.run.session_id == s.id
    assert first.run.verification == evidence
    card = next(i.payload for i in first.items if i.kind == "test_result")
    assert card["outcome"] == "execution_succeeded_needs_review"
    assert card["terminal_outputs"] == evidence.terminal_outputs
    dify.run_draft.return_value = Run(status="running")
    second = handler(env, turn, s, fc)
    assert second.context.verify_run_id == second.run.id != first.run.id


@pytest.mark.parametrize("flow", FLOWS)
def test_publish_verification_positive_and_final_race(flow):
    from core.dify_builder.errors import HashMismatchError
    from tests.unit_tests.core.dify_builder.fakes import successful_verification

    module, dify, repo, env, s, turn = fixture(flow)
    evidence = successful_verification(dify)
    run = Run(
        id="latest",
        dify_run_id="dify-run-1",
        session_id=s.id,
        kind="verify",
        immutable=True,
        status="succeeded",
        verification=evidence,
    )
    repo.save_run(s.id, run)
    fc = DifyBuilderContext(verify_run_id=run.id)
    decision = getattr(module, "handle_review", None) or module.handle_await_decision
    assert decision(env, turn, s, fc).next in {PcState.BUILD_PUBLISH, PcState.EDIT_PUBLISH, PcState.FIX_PUBLISH}
    dify.publish = Mock(side_effect=HashMismatchError("changed"))
    assert module.handle_publish(env, turn, s, fc).next == s.current_state
    dify.publish.assert_called_once_with(
        s.app_id,
        turn.actor,
        expected_revision=evidence.execution_revision,
        expected_graph_revision=evidence.executed_graph_revision,
    )


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_unresolved_output_never_invents_repair(flow):
    from core.dify_builder.models import OutputFinding

    module, dify, repo, env, s, turn = fixture(flow)
    evidence = RunVerification(
        execution_evidence=successful_verification(dify).execution_evidence,
        execution_revision=dify.hash,
        executed_graph_revision="graph",
        terminal_outputs={"result": None},
        output_findings=[
            OutputFinding(
                node_id="end",
                output_name="result",
                selector=["tool", "missing"],
                state="unresolved",
                reason="key_absent",
            )
        ],
        executed_node_ids=["tool", "end"],
        no_output_dead_branch=False,
    )
    dify.run_draft = Mock(return_value=Run(status="succeeded", verification=evidence))
    handler = (
        getattr(module, "handle_test_and_repair", None)
        or getattr(module, "handle_test_affected_paths", None)
        or module.handle_verify
    )
    fc = saved_test_context(env.repo, s.id)
    out = handler(env, turn, s, fc)
    assert out.run.status == "succeeded"
    assert not out.context.staged_repair
    card = next(i.payload for i in out.items if i.kind == "test_result")
    assert card["outcome"] == "required_output_unresolved"
    assert out.next in {PcState.BUILD_AWAIT_REPAIR, PcState.EDIT_AWAIT_REPAIR, PcState.FIX_AWAIT_DECISION}


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_failed_card_preserves_execution_outcome(flow):
    module, dify, repo, env, s, turn = fixture(flow)
    dify.verify_pass = False
    handler = (
        getattr(module, "handle_test_and_repair", None)
        or getattr(module, "handle_test_affected_paths", None)
        or module.handle_verify
    )
    result = handler(env, turn, s, saved_test_context(env.repo, s.id))
    card = next(i.payload for i in result.items if i.kind == "test_result")
    assert card["outcome"] == "execution_failed"


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_new_attempt_entry_clears_old_evidence(flow):
    module, _dify, _repo, env, session, turn = fixture(flow)
    turn.action.kind = flow[4]
    handler = (
        getattr(module, "handle_execution", None)
        or getattr(module, "handle_apply_changes", None)
        or module.handle_await_verify
    )
    result = handler(env, turn, session, DifyBuilderContext(verify_run_id="old"))
    assert result.context.verify_run_id == ""


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_unbound_success_reply_requires_retest(flow):
    module, dify, _repo, env, session, turn = fixture(flow)
    dify.run_draft = Mock(return_value=Run(status="succeeded"))
    handler = (
        getattr(module, "handle_test_and_repair", None)
        or getattr(module, "handle_test_affected_paths", None)
        or module.handle_verify
    )
    result = handler(env, turn, session, saved_test_context(env.repo, session.id))
    reply = next(item.payload["reply_text"] for item in result.items if item.kind == "assistant_turn")
    assert "Execution safety requires review" in reply
    assert result.context.staged_repair == []


@pytest.mark.parametrize("flow", FLOWS)
@pytest.mark.parametrize("failure_mode", ["native", "launch", "invalid_prepared_input"])
def test_verification_input_failure_retains_latest_persisted_attempt(flow, failure_mode):
    from core.dify_builder.models import TestInput
    from core.dify_builder.runner import Runner
    from tests.unit_tests.core.dify_builder.fakes import successful_verification

    module, dify, repo, env, session, turn = fixture(flow)
    dify.app_mode = "advanced-chat"
    working_state, waiting_state = {
        EntryMode.BUILD: (PcState.BUILD_TEST_AND_REPAIR, PcState.BUILD_AWAIT_TESTDATA),
        EntryMode.EDIT: (PcState.EDIT_TEST_AFFECTED_PATHS, PcState.EDIT_AWAIT_TESTDATA),
        EntryMode.FIX: (PcState.FIX_VERIFY, PcState.FIX_AWAIT_TESTDATA),
    }[session.entry_mode]
    session.current_state = working_state
    inputs = {"sys.query": "Hello", "document": {"id": "keep-upload"}}
    if failure_mode == "invalid_prepared_input":
        inputs.pop("sys.query")
    test_input = TestInput(id="inputs-before-failure", session_id=session.id, inputs=inputs)
    repo.save_test_input(test_input)
    prior = Run(
        id="earlier-success",
        session_id=session.id,
        kind="verify",
        immutable=True,
        status="succeeded",
        verification=successful_verification(dify),
    )
    repo.save_run(session.id, prior)
    repo.create_session(session, DifyBuilderContext(verify_run_id=prior.id, test_input_ref=test_input.id), [])
    native_error = "File variable not found for selector: ['start', 'document']"
    dify.run_draft = Mock(
        return_value=Run(
            status="failed", dify_run_id="dify-run-1", error=native_error, verification=failed_verification(dify)
        )
    )
    if failure_mode == "launch":
        dify.run_draft.side_effect = ValueError("query is required in input form")
    handler = (
        getattr(module, "handle_test_and_repair", None)
        or getattr(module, "handle_test_affected_paths", None)
        or module.handle_verify
    )
    runner = Runner(env, {working_state: handler, waiting_state: module.handle_await_testdata})
    runner.advance(session.id, Turn(actor=turn.actor))

    reloaded, context = repo.get_session(session.id)
    if failure_mode != "native":
        assert reloaded.current_state in {
            PcState.BUILD_AWAIT_REPAIR,
            PcState.EDIT_AWAIT_REPAIR,
            PcState.FIX_AWAIT_DECISION,
        }
        failed = repo.get_run(context.verify_run_id)
        assert failed is not None
        assert failed.status == "failed"
        assert failed.id != prior.id
        assert failed.verification is None
        assert not context.staged_repair
        assert context.test_input_ref == test_input.id
        assert not handlers_fix.publication_for_context(env, turn, reloaded, context).allowed
        assert not dify.published
        return
    assert reloaded.current_state == waiting_state
    assert context.verify_run_id
    assert context.verify_run_id != prior.id
    failed = repo.get_run(context.verify_run_id)
    assert failed.status == "failed"
    assert failed.session_id == session.id
    assert failed.immutable
    assert context.test_input_ref == ""
    assert dify.run_draft.call_count == (0 if failure_mode == "invalid_prepared_input" else 1)
    form = next(item.payload for item in repo.list_conversation(session.id) if item.kind == "form")
    assert form["variant"] == "testdata"
    assert form["frozen"] is False
    assert form["values"] == inputs
    assert any(field["key"] == "sys.query" for field in form["fields"])
    decision = handlers_fix.publication_for_context(env, turn, reloaded, context)
    assert decision.allowed is False
    assert decision.reason == "execution_failed"
    assert not dify.published

    # Correcting the input uses the existing form route and records a new
    # attempt without changing or losing the earlier immutable failure.
    corrected = {**inputs, "sys.query": "Corrected message"}
    dify.run_draft.side_effect = None
    dify.run_draft.return_value = Run(
        status="succeeded", dify_run_id="dify-run-1", verification=successful_verification(dify)
    )
    runner.advance(
        session.id,
        Turn(
            actor=turn.actor,
            action=Action(
                kind="provide_testdata", base_version=reloaded.version, payload={"mode": "provide", "inputs": corrected}
            ),
        ),
    )
    _after, corrected_context = repo.get_session(session.id)
    assert corrected_context.verify_run_id != failed.id
    assert repo.get_run(corrected_context.verify_run_id).status == "succeeded"
    assert repo.get_run(failed.id) == failed
    assert dify.run_draft.call_args.args[2] == corrected


@pytest.mark.parametrize("flow", FLOWS)
def test_verification_prelaunch_input_gate_still_clears_prior_evidence(flow):
    module, dify, _repo, env, session, turn = fixture(flow)
    dify.app_mode = "advanced-chat"
    dify.run_draft = Mock()
    turn.action = Action(kind="provide_testdata", payload={"mode": "provide", "inputs": {"sys.query": ""}})
    result = module.handle_await_testdata(
        env, turn, session, DifyBuilderContext(verify_run_id="older-run", test_input_ref="older-input")
    )
    assert result.run is None
    assert result.context.verify_run_id == ""
    assert result.context.test_input_ref == ""
    assert any(item.kind == "form" for item in result.items)
    dify.run_draft.assert_not_called()
