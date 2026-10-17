"""The confirmed full Test Run: the whole draft runs natively, unconfirmed side effects are mocked."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.dify_builder import handlers_build
from core.dify_builder.input_schema import SYSTEM_QUERY
from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, NodeOutput, Run, Session, Turn
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env
from core.dify_builder.state import PcState
from models.dify_builder import DifyBuilderRun, DifyBuilderSession, DifyBuilderTestInput
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowRun
from services.dify_builder import dify_port
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.effect_disclosure import disclose
from services.dify_builder.repository import SqlDifyBuilderRepository

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
    return next(item.signature for item in disclose(GRAPH, inputs={"topic": "x"}).items if item.node_id == node_id)


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'full-run.sqlite'}")
    for model in (
        DifyBuilderRun,
        DifyBuilderSession,
        DifyBuilderTestInput,
        BuiltinToolProvider,
        WorkflowRun,
        WorkflowNodeExecutionModel,
        WorkflowNodeExecutionOffload,
    ):
        model.__table__.create(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    ids = {key: str(uuid4()) for key in ("session", "input", "account", "tenant", "app")}
    saved = DifyBuilderTestInput(
        id=ids["input"], session_id=ids["session"], source="upload", inputs={"topic": "x"}, start_schema_hash="schema"
    )
    with factory.begin() as session:
        session.add(
            DifyBuilderSession(
                id=ids["session"],
                app_id=ids["app"],
                tenant_id=ids["tenant"],
                owner_account_id=ids["account"],
                entry_mode="build",
                current_state="build.test_and_repair",
                version=1,
            )
        )
        session.add(saved)
    app = SimpleNamespace(id=ids["app"], tenant_id=ids["tenant"], mode="workflow")
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
    native_finish = WorkflowServiceDifyPort._finish_run
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", lambda *_args, **_kwargs: (deepcopy(finished), None))
    monkeypatch.setattr(WorkflowServiceDifyPort, "_bind_run", lambda _self, result, *_args, **_kwargs: result[0])
    with (
        patch.object(dify_port, "_session_factory", return_value=factory),
        patch.object(dify_port, "db", SimpleNamespace(engine=engine)),
        patch.object(dify_port, "set_login_user"),
        patch.object(dify_port, "resolve_account", return_value=SimpleNamespace(id="acc-1")),
        patch.object(dify_port, "load_app", return_value=app),
        patch.object(dify_port, "_load_draft_workflow_or_raise", return_value=draft),
        patch.object(dify_port, "AppGenerateService") as generate,
    ):
        generate.generate.return_value = {"data": {"id": "native-1", "status": "succeeded"}}
        state = SimpleNamespace(
            app=app,
            saved=saved,
            generate=generate.generate,
            finished=finished,
            factory=factory,
            ids=ids,
            native_finish=native_finish,
        )
        yield state
    engine.dispose()


def _run(harness, confirmation=None, inputs=None, test_input_id="ti-1", *, on_workflow_event=None) -> Run:
    if inputs is not None:
        with harness.factory.begin() as session:
            session.get(DifyBuilderTestInput, harness.ids["input"]).inputs = inputs
    return WorkflowServiceDifyPort().run_draft(
        harness.ids["app"],
        Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"]),
        inputs or {"topic": "x"},
        lambda _event: None,
        session_id=harness.ids["session"],
        test_input_id=harness.ids["input"] if test_input_id == "ti-1" else test_input_id,
        effect_confirmation=confirmation,
        on_workflow_event=on_workflow_event,
    )


def test_unconfirmed_side_effects_are_mocked_and_listed(harness):
    run = _run(harness)

    kwargs = harness.generate.call_args.kwargs
    assert kwargs["builder_mocked_node_ids"] == frozenset({"slack", "purge"})
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert kwargs["workflow_execution_mode"] == "in_process"
    assert kwargs["builder_expected_revision"]
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
    run = _run(harness, {"slack": _signature("slack"), "purge": "anything"})

    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset({"purge"})
    assert run.verification.execution_evidence.simulated_node_ids == ()


def test_a_failed_run_is_sealed_native_failure_for_repair(harness):
    harness.finished.status = "failed"

    summary = _run(harness).verification.execution_evidence

    assert summary.safety_outcome == "native_failed"
    assert summary.sealed is True


def test_a_run_without_native_proof_is_unknown(harness):
    harness.finished.dify_run_id = ""

    summary = _run(harness).verification.execution_evidence

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert summary.sealed is False


def test_test_input_from_another_session_is_refused(harness):
    with harness.factory.begin() as session:
        session.get(DifyBuilderTestInput, harness.ids["input"]).session_id = str(uuid4())

    run = _run(harness)

    assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "test_input_binding_mismatch"
    harness.generate.assert_not_called()


def test_chatflow_sends_the_user_message_as_the_query(harness):
    harness.app.mode = "advanced-chat"

    _run(harness, inputs={SYSTEM_QUERY: "hello", "topic": "x"})

    assert harness.generate.call_args.kwargs["args"] == {"query": "hello", "inputs": {"topic": "x"}}


@pytest.mark.parametrize("status", ["succeeded", "failed"])
def test_completed_attempt_recovers_after_builder_result_commit_is_lost(harness, status):
    """Dropping the handler result must not repeat the already completed native effect."""
    effects = []
    harness.finished.status = status

    def generate(**_kwargs):
        effects.append("sent")
        return {"data": {"id": "native-1", "status": status}}

    harness.generate.side_effect = generate
    _run(harness)  # The caller crashes instead of committing this returned result.
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == status
    assert recovered.dify_run_id == "native-1"


def test_lost_launch_acknowledgement_stays_unknown_without_relaunch(harness):
    effects = []

    def generate(**_kwargs):
        effects.append("sent")
        raise RuntimeError("connection lost after dispatch")

    harness.generate.side_effect = generate
    first = _run(harness)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert first.status == recovered.status == "running"
    assert first.dify_run_id == recovered.dify_run_id == ""
    assert not recovered.verification.execution_evidence.sealed
    assert recovered.verification.execution_evidence.simulated_node_ids == ()


def test_interruption_in_first_event_callback_recovers_bound_native_run(harness):
    effects = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs):
        effects.append("sent")
        return iter([{"event": "workflow_started", "workflow_run_id": "native-1", "data": {"id": "native-1"}}])

    def interrupt(_event):
        raise Interrupted()

    harness.generate.side_effect = generate
    with pytest.raises(Interrupted):
        _run(harness, on_workflow_event=interrupt)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == "succeeded"
    assert recovered.dify_run_id == "native-1"
    with harness.factory() as session:
        reservations = list(session.scalars(select(DifyBuilderRun)))
    assert len(reservations) == 1
    assert reservations[0].dify_run_id == "native-1"


def test_interruption_before_native_acknowledgement_never_relaunches(harness):
    effects = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs):
        effects.append("sent")
        raise Interrupted()

    harness.generate.side_effect = generate
    with pytest.raises(Interrupted):
        _run(harness)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == "running"
    assert recovered.dify_run_id == ""


def test_committed_reservation_before_native_launch_survives_interruption(harness, monkeypatch):
    reserve = WorkflowServiceDifyPort._reserve_full_run

    class Interrupted(BaseException):
        pass

    def interrupt_after_reservation(self, *args):
        reserve(self, *args)
        raise Interrupted()

    with monkeypatch.context() as interrupted:
        interrupted.setattr(WorkflowServiceDifyPort, "_reserve_full_run", interrupt_after_reservation)
        with pytest.raises(Interrupted):
            _run(harness)
    recovered = _run(harness)

    assert recovered.status == "running"
    harness.generate.assert_not_called()


def test_interruption_before_result_snapshot_commit_recovers_without_relaunch(harness, monkeypatch):
    effects = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs):
        effects.append("sent")
        return {"data": {"id": "native-1", "status": "succeeded"}}

    def interrupt(_reservation_id, _run):
        raise Interrupted()

    harness.generate.side_effect = generate
    with monkeypatch.context() as interrupted:
        interrupted.setattr(WorkflowServiceDifyPort, "_save_full_run_result", staticmethod(interrupt))
        with pytest.raises(Interrupted):
            _run(harness)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == "succeeded"
    assert recovered.dify_run_id == "native-1"


def test_concurrent_deliveries_have_one_durable_launch_winner(harness):
    """Real separate SQLite transactions exercise the reservation PK conflict."""
    started, finish = threading.Event(), threading.Event()
    effects = []

    def generate(**_kwargs):
        effects.append("sent")
        started.set()
        assert finish.wait(5)
        return {"data": {"id": "native-1", "status": "succeeded"}}

    harness.generate.side_effect = generate
    with ThreadPoolExecutor(max_workers=2) as pool:
        winner = pool.submit(_run, harness)
        assert started.wait(5)
        try:
            duplicate = pool.submit(_run, harness).result(timeout=5)
        finally:
            finish.set()
        completed = winner.result(timeout=5)

    assert effects == ["sent"]
    assert duplicate.status == "running"
    assert completed.status == "succeeded"
    with harness.factory() as session:
        assert len(list(session.scalars(select(DifyBuilderRun)))) == 1


def test_recovery_keeps_existing_attempt_when_runtime_selection_changes(harness, monkeypatch):
    effects = []

    def generate(**_kwargs):
        effects.append("sent")
        return {"data": {"id": "native-1", "status": "succeeded"}}

    harness.generate.side_effect = generate
    _run(harness)
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_RUN_ENABLED", False)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.dify_run_id == "native-1"


@pytest.mark.parametrize("status", ["succeeded", "failed", "running"])
def test_recovery_reads_the_existing_native_database_outcome(harness, monkeypatch, status):
    native_id = str(uuid4())
    effects = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs):
        effects.append("sent")
        with harness.factory.begin() as session:
            session.add(
                WorkflowRun(
                    id=native_id,
                    tenant_id=harness.ids["tenant"],
                    app_id=harness.ids["app"],
                    workflow_id=str(uuid4()),
                    type="workflow",
                    triggered_from="debugging",
                    version="draft",
                    graph=json.dumps(GRAPH),
                    inputs=json.dumps({"topic": "x"}),
                    status=status,
                    created_by_role="account",
                    created_by=harness.ids["account"],
                    outputs=json.dumps({"answer": "done"}),
                )
            )
        return iter([{"event": "workflow_started", "workflow_run_id": native_id, "data": {"id": native_id}}])

    def interrupt(_event):
        raise Interrupted()

    harness.generate.side_effect = generate
    with pytest.raises(Interrupted):
        _run(harness, on_workflow_event=interrupt)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", harness.native_finish)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == status
    assert recovered.dify_run_id == native_id
    assert recovered.verification.execution_evidence.sealed is (status != "running")


def test_working_build_handler_reentry_after_result_commit_failure_keeps_one_effect(harness):
    effects = []

    def generate(**_kwargs):
        effects.append("sent")
        return {"data": {"id": "native-1", "status": "succeeded"}}

    harness.generate.side_effect = generate
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    session = Session(
        id=harness.ids["session"],
        app_id=harness.ids["app"],
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_TEST_AND_REPAIR,
    )
    context = DifyBuilderContext(test_input_ref=harness.ids["input"])
    env = Env(
        dify=WorkflowServiceDifyPort(),
        repo=SqlDifyBuilderRepository(harness.factory),
        agent=PlaceholderAgent(),
        now=lambda: None,
    )
    # The first handler result is discarded as if the following CAS failed.
    handlers_build.handle_test_and_repair(env, Turn(actor=actor), session, deepcopy(context))
    recovered = handlers_build.handle_test_and_repair(env, Turn(actor=actor), session, deepcopy(context))

    assert effects == ["sent"]
    assert recovered.run.status == "succeeded"
    assert recovered.run.dify_run_id == "native-1"


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
