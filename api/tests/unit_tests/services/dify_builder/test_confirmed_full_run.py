"""The confirmed full Test Run: the whole draft runs natively, unconfirmed side effects are mocked."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.dify_builder.input_schema import SYSTEM_QUERY
from core.dify_builder.models import Actor, NodeOutput, Run
from models.dify_builder import DifyBuilderTestInput
from models.workflow import Workflow
from services.dify_builder import dify_port
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.effect_disclosure import disclose

GRAPH = {
    "nodes": [
        {"id": "start", "data": {"type": "start", "title": "Start"}},
        {"id": "llm", "data": {"type": "llm", "title": "Draft", "model": {"provider": "openai", "name": "gpt-4o"}}},
        {
            "id": "slack",
            "data": {
                "type": "tool",
                "title": "Notify",
                "provider_id": "langgenius/slack/slack",
                "provider_type": "builtin",
                "tool_name": "send_message",
                "tool_parameters": {},
            },
        },
        {"id": "purge", "data": {"type": "http-request", "title": "Purge", "method": "delete", "url": "https://x.io"}},
    ],
    "edges": [],
}


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _signature(node_id: str) -> str:
    return next(item.signature for item in disclose(GRAPH).items if item.node_id == node_id)


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch):
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    saved = SimpleNamespace(session_id="session-1")
    session.get.side_effect = lambda model, _id: saved if model is DifyBuilderTestInput else None
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="workflow")
    draft = Workflow(
        tenant_id="tenant-1",
        graph=json.dumps(GRAPH),
        features="{}",
        environment_variables=[],
        conversation_variables=[],
    )
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_RUN_ENABLED", True)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_restricted_admissible", lambda *_args: False)
    finished = Run(
        status="succeeded",
        dify_run_id="native-1",
        per_node=[NodeOutput(node_id="start"), NodeOutput(node_id="slack"), NodeOutput(node_id="llm")],
    )
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", lambda *_args, **_kwargs: (finished, None))
    monkeypatch.setattr(WorkflowServiceDifyPort, "_bind_run", lambda _self, result, *_args, **_kwargs: result[0])
    with (
        patch.object(dify_port, "sessionmaker", return_value=MagicMock(return_value=session)),
        patch.object(dify_port, "db"),
        patch.object(dify_port, "set_login_user"),
        patch.object(dify_port, "resolve_account", return_value=SimpleNamespace(id="acc-1")),
        patch.object(dify_port, "load_app", return_value=app),
        patch.object(dify_port, "_load_draft_workflow_or_raise", return_value=draft),
        patch.object(dify_port, "AppGenerateService") as generate,
    ):
        generate.generate.return_value = iter(())
        yield SimpleNamespace(app=app, saved=saved, generate=generate.generate, finished=finished)


def _run(confirmation=None, inputs=None, test_input_id="ti-1") -> Run:
    return WorkflowServiceDifyPort().run_draft(
        "app-1",
        _actor(),
        inputs or {"topic": "x"},
        lambda _event: None,
        session_id="session-1",
        test_input_id=test_input_id,
        effect_confirmation=confirmation,
    )


def test_unconfirmed_side_effects_are_mocked_and_listed(harness):
    run = _run()

    kwargs = harness.generate.call_args.kwargs
    assert kwargs["builder_mocked_node_ids"] == frozenset({"slack", "purge"})
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert kwargs["workflow_execution_mode"] == "in_process"
    assert kwargs["args"] == {"inputs": {"topic": "x"}}
    summary = run.verification.execution_evidence
    assert (summary.policy_version, summary.mode, summary.sandbox_profile) == (
        "builder-confirmed-run-v1",
        "confirmed_run",
        "native",
    )
    assert summary.sealed is True
    assert summary.safety_outcome == "confirmed_run_completed"
    assert summary.native_run_id == "native-1"
    # Only executed steps are listed; the purge branch never ran.
    assert summary.simulated_node_ids == ("slack",)


def test_a_confirmed_side_effect_runs_for_real_and_destructive_stays_mocked(harness):
    run = _run({"slack": _signature("slack"), "purge": "anything"})

    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset({"purge"})
    assert run.verification.execution_evidence.simulated_node_ids == ()


def test_a_failed_run_is_sealed_native_failure_for_repair(harness):
    harness.finished.status = "failed"

    summary = _run().verification.execution_evidence

    assert summary.safety_outcome == "native_failed"
    assert summary.sealed is True


def test_a_run_without_native_proof_is_unknown(harness):
    harness.finished.dify_run_id = ""

    summary = _run().verification.execution_evidence

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert summary.sealed is False


def test_test_input_from_another_session_is_refused(harness):
    harness.saved.session_id = "other"

    run = _run()

    assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "test_input_binding_mismatch"
    harness.generate.assert_not_called()


def test_chatflow_sends_the_user_message_as_the_query(harness):
    harness.app.mode = "advanced-chat"

    _run(inputs={SYSTEM_QUERY: "hello", "topic": "x"})

    assert harness.generate.call_args.kwargs["args"] == {"query": "hello", "inputs": {"topic": "x"}}


@pytest.mark.usefixtures("harness")
def test_disclosure_is_empty_when_the_flag_is_off(monkeypatch: pytest.MonkeyPatch):
    assert {item.node_id for item in WorkflowServiceDifyPort().disclose_effects("app-1", _actor()).confirmable} == {
        "slack"
    }

    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_RUN_ENABLED", False)

    assert WorkflowServiceDifyPort().disclose_effects("app-1", _actor()).items == ()


@pytest.mark.usefixtures("harness")
def test_disclosure_is_empty_when_the_restricted_runtime_admits_the_draft(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(WorkflowServiceDifyPort, "_restricted_admissible", lambda *_args: True)

    assert WorkflowServiceDifyPort().disclose_effects("app-1", _actor()).items == ()
