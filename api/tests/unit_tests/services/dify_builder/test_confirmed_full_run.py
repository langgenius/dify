"""The confirmed full Test Run: the whole draft runs natively, unconfirmed side effects are mocked."""

import json
import pathlib
import threading
from collections.abc import Callable, Generator, Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import Never
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine, Table, create_engine, select
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.dify_builder.input_schema import SYSTEM_QUERY
from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, Graph, NodeOutput, Run, Session, Turn
from core.dify_builder.state import PcState
from models.account import Account
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderRun, DifyBuilderSession, DifyBuilderTestInput
from models.model import App, AppMode
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowRun
from runtime_contracts.builder.execution import canonical_digest
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.contracts import CheckpointRef, NativeTestContextRef, WaitingReceipt
from services.dify_builder import dify_port
from services.dify_builder.application import handlers_build
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.runner import Env
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.effect_disclosure import disclose
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.unit_tests.config_override import apply_config_overrides

GRAPH: Graph = {
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


@dataclass(frozen=True)
class FullRunDatabase:
    engine: Engine


@dataclass
class FullRunCase:
    app: App
    draft: Workflow
    saved: DifyBuilderTestInput
    generate: MagicMock
    finished: Run
    factory: sessionmaker[SqlSession]
    ids: dict[str, str]
    native_finish: Callable[[WorkflowServiceDifyPort, str, str, dict[str, object], str], tuple[Run, object]]


def prepared_agent_context() -> BuilderAgentExecutionContext:
    return BuilderAgentExecutionContext(
        ref=NativeTestContextRef(request_id="request", invocation_id="root", context_digest="a" * 64),
        native_run_id=str(uuid4()),
    )


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _signature(node_id: str) -> str:
    return next(item.signature for item in disclose(GRAPH, inputs={"topic": "x"}).items if item.node_id == node_id)


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path) -> Generator[FullRunCase]:
    engine = create_engine(f"sqlite:///{tmp_path / 'full-run.sqlite'}")
    for model in (
        DifyBuilderRun,
        DifyBuilderExecutionRequest,
        DifyBuilderSession,
        DifyBuilderTestInput,
        BuiltinToolProvider,
        WorkflowRun,
        WorkflowNodeExecutionModel,
        WorkflowNodeExecutionOffload,
    ):
        table = model.__table__
        assert isinstance(table, Table)
        table.create(engine)
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
    app = App(id=ids["app"], tenant_id=ids["tenant"], mode="workflow")
    draft = Workflow(
        tenant_id="tenant-1",
        graph=json.dumps(GRAPH),
        features="{}",
        environment_variables=[],
        conversation_variables=[],
    )
    apply_config_overrides(monkeypatch, DIFY_BUILDER_CONFIRMED_RUN_ENABLED=True)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_restricted_admissible", lambda *_args: False)
    finished = Run(
        status="succeeded",
        dify_run_id="native-1",
        per_node=[NodeOutput(node_id="start"), NodeOutput(node_id="slack"), NodeOutput(node_id="llm")],
    )
    native_finish = WorkflowServiceDifyPort._finish_run
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", lambda *_args, **_kwargs: (deepcopy(finished), None))
    monkeypatch.setattr(WorkflowServiceDifyPort, "_bind_run", lambda _self, result, *_args, **_kwargs: result[0])
    account = Account(name="Owner", email="owner@example.invalid")
    account.id = "acc-1"
    with (
        patch.object(dify_port, "_session_factory", return_value=factory),
        patch.object(dify_port, "db", FullRunDatabase(engine=engine)),
        patch.object(dify_port, "set_login_user"),
        patch.object(dify_port, "resolve_account", return_value=account),
        patch.object(dify_port, "load_app", return_value=app),
        patch.object(dify_port, "_load_draft_workflow_or_raise", return_value=draft),
        patch.object(dify_port.AppGenerateService, "generate") as generate,
    ):
        generate.return_value = {"data": {"id": "native-1", "status": "succeeded"}}
        state = FullRunCase(
            app=app,
            draft=draft,
            saved=saved,
            generate=generate,
            finished=finished,
            factory=factory,
            ids=ids,
            native_finish=native_finish,
        )
        yield state
    engine.dispose()


def test_real_agent_admission_uses_reserved_parent_and_current_saved_input(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    graph: Graph = {
        "nodes": [{"id": "agent-1", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
        "edges": [],
    }
    harness.draft.graph = json.dumps(graph)
    signature = disclose(graph, inputs={"topic": "x"}).items[0].signature
    seen: list[dict[str, object]] = []
    context = prepared_agent_context()
    monkeypatch.setattr(
        WorkflowServiceDifyPort,
        "_prepare_confirmed_agent_execution",
        staticmethod(lambda **kwargs: seen.append(kwargs) or context),
    )
    _run(harness, {"agent-1": signature})
    assert len(seen) == 1
    assert seen[0]["session_id"] == harness.ids["session"]
    assert seen[0]["test_input_id"] == harness.ids["input"]
    assert seen[0]["expected_version"] == 1
    assert harness.generate.call_args.kwargs["builder_agent_execution"] is context


def test_mocked_agent_never_admits_a_real_agent_scope(harness: FullRunCase) -> None:
    harness.draft.graph = json.dumps({"nodes": [{"id": "agent-1", "data": {"type": "agent"}}], "edges": []})
    with patch.object(WorkflowServiceDifyPort, "_prepare_confirmed_agent_execution") as prepare:
        _run(harness, {})
    prepare.assert_not_called()
    assert harness.generate.call_args.kwargs.get("builder_agent_execution") is None


def test_parent_recovery_requires_an_actual_fully_owned_native_row(harness: FullRunCase) -> None:
    native_id, workflow_id = str(uuid4()), str(uuid4())
    context = {"profile": {"profile_id": "builder-agent-confirmed-v1"}, "native_run_id": native_id}
    with harness.factory.begin() as session:
        session.add(
            DifyBuilderExecutionRequest(
                id=str(uuid4()),
                tenant_id=harness.ids["tenant"],
                actor_id=harness.ids["account"],
                app_id=harness.ids["app"],
                workflow_id=workflow_id,
                session_id=harness.ids["session"],
                test_input_id=harness.ids["input"],
                context=context,
                context_digest=canonical_digest(context),
                state="prepared",
                observations=[],
            )
        )
    kwargs = {
        "actor": Actor(tenant_id=harness.ids["tenant"], account_id=harness.ids["account"]),
        "app_id": harness.ids["app"],
        "session_id": harness.ids["session"],
        "test_input_id": harness.ids["input"],
        "graph": {"nodes": [{"id": "agent", "data": {"type": "agent"}}]},
    }
    recover = WorkflowServiceDifyPort._recover_confirmed_agent_parent_id
    assert (
        recover(
            actor=kwargs["actor"],
            app_id=kwargs["app_id"],
            session_id=kwargs["session_id"],
            test_input_id=kwargs["test_input_id"],
            graph=kwargs["graph"],
        )
        is None
    )
    with harness.factory.begin() as session:
        session.add(
            WorkflowRun(
                id=native_id,
                tenant_id=harness.ids["tenant"],
                app_id=harness.ids["app"],
                workflow_id=workflow_id,
                type="workflow",
                triggered_from="debugging",
                version="draft",
                graph=json.dumps(kwargs["graph"]),
                inputs="{}",
                status="running",
                created_by_role="account",
                created_by=str(uuid4()),
            )
        )
    assert (
        recover(
            actor=kwargs["actor"],
            app_id=kwargs["app_id"],
            session_id=kwargs["session_id"],
            test_input_id=kwargs["test_input_id"],
            graph=kwargs["graph"],
        )
        is None
    )
    with harness.factory.begin() as session:
        native = session.get(WorkflowRun, native_id)
        assert native is not None
        native.created_by = harness.ids["account"]
    assert (
        recover(
            actor=kwargs["actor"],
            app_id=kwargs["app_id"],
            session_id=kwargs["session_id"],
            test_input_id=kwargs["test_input_id"],
            graph=kwargs["graph"],
        )
        == native_id
    )


@pytest.mark.parametrize("barrier_ok", [True, False])
def test_confirmed_pause_frame_is_public_only_after_durable_parent_barrier(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, barrier_ok: bool
) -> None:
    graph: Graph = {
        "nodes": [{"id": "agent-1", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
        "edges": [],
    }
    harness.draft.graph = json.dumps(graph)
    signature = disclose(graph, inputs={"topic": "x"}).items[0].signature
    monkeypatch.setattr(
        WorkflowServiceDifyPort,
        "_prepare_confirmed_agent_execution",
        staticmethod(lambda **_kwargs: prepared_agent_context()),
    )
    harness.generate.return_value = iter([{"event": "workflow_paused", "data": {"id": "native-1"}}])
    monkeypatch.setattr(
        WorkflowServiceDifyPort,
        "_finish_run",
        lambda *_args, **_kwargs: (
            Run(status="failed", dify_run_id="native-1"),
            WorkflowRun(status="paused", graph=json.dumps(graph)),
        ),
    )
    order: list[str] = []

    def barrier(**_kwargs: object) -> WaitingReceipt:
        order.append("barrier")
        if not barrier_ok:
            raise RuntimeError("storage unavailable")
        return WaitingReceipt(
            request_id="request",
            invocation_id="root",
            generation=1,
            checkpoint=CheckpointRef(checkpoint_id="checkpoint", payload_digest="a" * 64),
            pending_operation_ids=("operation",),
            wait_reason="approval",
        )

    monkeypatch.setattr(WorkflowServiceDifyPort, "_settle_confirmed_agent_parent", staticmethod(barrier))
    result = _run(harness, {"agent-1": signature}, on_workflow_event=lambda _event: order.append("public"))
    assert order == (["barrier", "public"] if barrier_ok else ["barrier"])
    assert result.status == "running"
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.sealed is False


def test_legacy_agent_cannot_use_confirmed_profile_to_bypass_nested_tool_controls(harness: FullRunCase) -> None:
    graph: Graph = {"nodes": [{"id": "legacy", "data": {"type": "agent", "version": "1"}}], "edges": []}
    harness.draft.graph = json.dumps(graph)
    signature = disclose(graph, inputs={"topic": "x"}).items[0].signature
    result = _run(harness, {"legacy": signature})
    harness.generate.assert_not_called()
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "unsupported_node_implementation"


def _run(
    harness: FullRunCase,
    confirmation: Mapping[str, str] | None = None,
    inputs: dict[str, object] | None = None,
    test_input_id: str = "ti-1",
    *,
    on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
) -> Run:
    if inputs is not None:
        with harness.factory.begin() as session:
            stored_input = session.get(DifyBuilderTestInput, harness.ids["input"])
            assert stored_input is not None
            stored_input.inputs = inputs
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


def test_unconfirmed_side_effects_are_mocked_and_listed(harness: FullRunCase) -> None:
    run = _run(harness)

    kwargs = harness.generate.call_args.kwargs
    assert kwargs["builder_mocked_node_ids"] == frozenset({"slack", "purge"})
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER
    assert kwargs["workflow_execution_mode"] == "in_process"
    assert kwargs["builder_expected_revision"]
    assert kwargs["args"] == {"inputs": {"topic": "x"}}
    assert run.verification is not None
    summary = run.verification.execution_evidence
    assert summary is not None
    assert (summary.policy_version, summary.mode, summary.sandbox_profile) == (
        "builder-confirmed-run-v1",
        "confirmed_run",
        "native",
    )
    assert summary is not None
    assert summary.sealed is True
    assert summary is not None
    assert summary.safety_outcome == "confirmed_run_completed"
    assert summary is not None
    assert summary.native_run_id == "native-1"
    # Only executed steps are listed; the purge branch never ran.
    assert summary is not None
    assert summary.simulated_node_ids == ("slack",)


def test_a_confirmed_side_effect_runs_for_real_and_destructive_stays_mocked(harness: FullRunCase) -> None:
    run = _run(harness, {"slack": _signature("slack"), "purge": "anything"})

    assert harness.generate.call_args.kwargs["builder_mocked_node_ids"] == frozenset({"purge"})
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    assert run.verification.execution_evidence.simulated_node_ids == ()


def test_a_failed_run_is_sealed_native_failure_for_repair(harness: FullRunCase) -> None:
    harness.finished.status = "failed"

    result = _run(harness)
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None

    assert summary.safety_outcome == "native_failed"
    assert summary.sealed is True


def test_a_run_without_native_proof_is_unknown(harness: FullRunCase) -> None:
    harness.finished.dify_run_id = ""

    result = _run(harness)
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None

    assert summary.safety_outcome == "execution_evidence_unknown"
    assert summary.sealed is False


def test_test_input_from_another_session_is_refused(harness: FullRunCase) -> None:
    with harness.factory.begin() as session:
        saved_input = session.get(DifyBuilderTestInput, harness.ids["input"])
        assert saved_input is not None
        saved_input.session_id = str(uuid4())

    run = _run(harness)

    assert run.execution_refusal is not None
    assert run.execution_refusal.reason_code == "test_input_binding_mismatch"
    harness.generate.assert_not_called()


def test_chatflow_sends_the_user_message_as_the_query(harness: FullRunCase) -> None:
    harness.app.mode = AppMode.ADVANCED_CHAT

    _run(harness, inputs={SYSTEM_QUERY: "hello", "topic": "x"})

    assert harness.generate.call_args.kwargs["args"] == {"query": "hello", "inputs": {"topic": "x"}}


@pytest.mark.parametrize("status", ["succeeded", "failed"])
def test_completed_attempt_recovers_after_builder_result_commit_is_lost(harness: FullRunCase, status: str) -> None:
    """Dropping the handler result must not repeat the already completed native effect."""
    effects: list[str] = []
    harness.finished.status = status

    def generate(**_kwargs: object) -> dict[str, dict[str, str]]:
        effects.append("sent")
        return {"data": {"id": "native-1", "status": status}}

    harness.generate.side_effect = generate
    _run(harness)  # The caller crashes instead of committing this returned result.
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == status
    assert recovered.dify_run_id == "native-1"


def test_lost_launch_acknowledgement_stays_unknown_without_relaunch(harness: FullRunCase) -> None:
    effects: list[str] = []

    def generate(**_kwargs: object) -> Never:
        effects.append("sent")
        raise RuntimeError("connection lost after dispatch")

    harness.generate.side_effect = generate
    first = _run(harness)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert first.status == recovered.status == "running"
    assert first.dify_run_id == recovered.dify_run_id == ""
    assert recovered.verification is not None
    assert recovered.verification.execution_evidence is not None
    assert not recovered.verification.execution_evidence.sealed
    assert recovered.verification is not None
    assert recovered.verification.execution_evidence is not None
    assert recovered.verification.execution_evidence.simulated_node_ids == ()


def test_interruption_in_first_event_callback_recovers_bound_native_run(harness: FullRunCase) -> None:
    effects: list[str] = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs: object) -> Iterator[dict[str, str | dict[str, str]]]:
        effects.append("sent")
        return iter([{"event": "workflow_started", "workflow_run_id": "native-1", "data": {"id": "native-1"}}])

    def interrupt(_event: object) -> Never:
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


def test_interruption_before_native_acknowledgement_never_relaunches(harness: FullRunCase) -> None:
    effects: list[str] = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs: object) -> Never:
        effects.append("sent")
        raise Interrupted()

    harness.generate.side_effect = generate
    with pytest.raises(Interrupted):
        _run(harness)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == "running"
    assert recovered.dify_run_id == ""


def test_committed_reservation_before_native_launch_survives_interruption(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    reserve = WorkflowServiceDifyPort._reserve_full_run

    class Interrupted(BaseException):
        pass

    def interrupt_after_reservation(
        self: WorkflowServiceDifyPort,
        session_id: str,
        test_input_id: str,
        before_revision: str,
        before_graph_revision: str,
        mocked: frozenset[str],
    ) -> Never:
        reserve(self, session_id, test_input_id, before_revision, before_graph_revision, mocked)
        raise Interrupted()

    with monkeypatch.context() as interrupted:
        interrupted.setattr(WorkflowServiceDifyPort, "_reserve_full_run", interrupt_after_reservation)
        with pytest.raises(Interrupted):
            _run(harness)
    recovered = _run(harness)

    assert recovered.status == "running"
    harness.generate.assert_not_called()


def test_interruption_before_result_snapshot_commit_recovers_without_relaunch(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    effects: list[str] = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs: object) -> dict[str, dict[str, str]]:
        effects.append("sent")
        return {"data": {"id": "native-1", "status": "succeeded"}}

    def interrupt(_reservation_id: object, _run: object) -> Never:
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


def test_concurrent_deliveries_have_one_durable_launch_winner(harness: FullRunCase) -> None:
    """Real separate SQLite transactions exercise the reservation PK conflict."""
    started, finish = threading.Event(), threading.Event()
    effects: list[str] = []

    def generate(**_kwargs: object) -> dict[str, dict[str, str]]:
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


def test_recovery_keeps_existing_attempt_when_runtime_selection_changes(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    effects: list[str] = []

    def generate(**_kwargs: object) -> dict[str, dict[str, str]]:
        effects.append("sent")
        return {"data": {"id": "native-1", "status": "succeeded"}}

    harness.generate.side_effect = generate
    _run(harness)
    apply_config_overrides(monkeypatch, DIFY_BUILDER_CONFIRMED_RUN_ENABLED=False)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.dify_run_id == "native-1"


@pytest.mark.parametrize("status", ["succeeded", "failed", "running"])
def test_recovery_reads_the_existing_native_database_outcome(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    native_id = str(uuid4())
    effects: list[str] = []

    class Interrupted(BaseException):
        pass

    def generate(**_kwargs: object) -> Iterator[dict[str, str | dict[str, str]]]:
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

    def interrupt(_event: object) -> Never:
        raise Interrupted()

    harness.generate.side_effect = generate
    with pytest.raises(Interrupted):
        _run(harness, on_workflow_event=interrupt)
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", harness.native_finish)
    recovered = _run(harness)

    assert effects == ["sent"]
    assert recovered.status == status
    assert recovered.dify_run_id == native_id
    assert recovered.verification is not None
    assert recovered.verification.execution_evidence is not None
    assert recovered.verification.execution_evidence.sealed is (status != "running")


def test_working_build_handler_reentry_after_result_commit_failure_keeps_one_effect(harness: FullRunCase) -> None:
    effects: list[str] = []

    def generate(**_kwargs: object) -> dict[str, dict[str, str]]:
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
        now=lambda: datetime.min,
    )
    # The first handler result is discarded as if the following CAS failed.
    handlers_build.handle_test_and_repair(env, Turn(actor=actor), session, deepcopy(context))
    recovered = handlers_build.handle_test_and_repair(env, Turn(actor=actor), session, deepcopy(context))

    assert effects == ["sent"]
    assert recovered.run is not None
    assert recovered.run.status == "succeeded"
    assert recovered.run is not None
    assert recovered.run.dify_run_id == "native-1"


@pytest.mark.usefixtures("harness")
def test_disclosure_is_empty_when_the_flag_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    assert {item.node_id for item in WorkflowServiceDifyPort().disclose_effects("app-1", _actor()).confirmable} == {
        "slack"
    }

    apply_config_overrides(monkeypatch, DIFY_BUILDER_CONFIRMED_RUN_ENABLED=False)

    assert WorkflowServiceDifyPort().disclose_effects("app-1", _actor()).items == ()


@pytest.mark.usefixtures("harness")
def test_disclosure_is_empty_when_the_restricted_runtime_admits_the_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(WorkflowServiceDifyPort, "_restricted_admissible", lambda *_args: True)

    assert WorkflowServiceDifyPort().disclose_effects("app-1", _actor()).items == ()


def test_observed_preparation_failure_is_failed_and_never_redispatched(harness: FullRunCase) -> None:
    from services.dify_builder.native_launch_observation import begin_preparation

    def generate(**_kwargs: object) -> Never:
        begin_preparation()
        raise ConnectionRefusedError("private plugin-daemon address token=secret")

    harness.generate.side_effect = generate
    first = _run(harness)
    recovered = _run(harness)
    assert first.status == recovered.status == "failed"
    assert harness.generate.call_count == 1
    assert not first.dify_run_id
    assert first.verification is not None
    evidence = first.verification.execution_evidence
    assert evidence is not None
    assert evidence.sealed
    assert evidence is not None
    assert evidence.safety_outcome == "preparation_failed"
    assert evidence is not None
    assert evidence.failure_phase == "preparation"
    assert evidence is not None
    assert evidence.failure_reason == "connection_refused"
    assert "secret" not in first.error


def test_error_after_observed_dispatch_remains_unknown(harness: FullRunCase) -> None:
    from services.dify_builder.native_launch_observation import begin_preparation, mark_dispatched

    def generate(**_kwargs: object) -> Never:
        begin_preparation()
        mark_dispatched()
        raise ConnectionRefusedError("lost acknowledgement")

    harness.generate.side_effect = generate
    first = _run(harness)
    recovered = _run(harness)
    assert first.status == recovered.status == "running"
    assert harness.generate.call_count == 1
    assert first.verification is not None
    assert first.verification.execution_evidence is not None
    assert first.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"


def test_closed_preparation_failure_is_not_reconciled_as_a_dispatched_run(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.native_launch_observation import begin_preparation

    def generate(**_kwargs: object) -> Never:
        begin_preparation()
        raise ConnectionRefusedError("private endpoint")

    harness.generate.side_effect = generate
    _run(harness)
    monkeypatch.setattr(
        WorkflowServiceDifyPort,
        "_recover_confirmed_agent_parent_id",
        staticmethod(
            lambda **_: (_ for _ in ()).throw(AssertionError("closed preparation must not recover a dispatch"))
        ),
    )
    recovered = _run(harness)
    assert recovered.immutable
    assert recovered.status == "failed"
    assert recovered.verification is not None
    assert recovered.verification.execution_evidence is not None
    assert recovered.verification.execution_evidence.failure_phase == "preparation"
    assert harness.generate.call_count == 1


def test_preparation_failure_identifies_only_the_observed_resource_nodes(harness: FullRunCase) -> None:
    from services.dify_builder.native_launch_observation import begin_preparation, observe_resource

    graph = json.loads(harness.draft.graph)
    graph["nodes"][1]["data"]["model"] = {"provider": "provider", "name": "model"}
    harness.draft.graph = json.dumps(graph)

    def generate(**_kwargs: object) -> None:
        begin_preparation()
        with observe_resource("model", "provider", "model"):
            raise ConnectionRefusedError("private secret")

    harness.generate.side_effect = generate
    run = _run(harness)
    assert run.verification is not None
    evidence = run.verification.execution_evidence
    assert evidence is not None
    assert evidence.failure_resource == ("model", "provider", "model")
    assert evidence is not None
    assert evidence.failure_node_ids == ("llm",)
    assert evidence is not None
    assert evidence.native_run_id is None
    assert run.per_node == []


def test_failed_native_plugin_resource_uses_actual_historical_graph(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.dify_port import WorkflowServiceDifyPort

    harness.finished.status = "failed"
    harness.finished.per_node = [
        NodeOutput(node_id="llm", status="failed", error="Request to Plugin Daemon Service failed-500")
    ]
    historical = {
        "nodes": [
            {
                "id": "llm",
                "data": {
                    "type": "llm",
                    "model": {"provider": "langgenius/anthropic/anthropic", "name": "actual-model"},
                },
            }
        ]
    }
    monkeypatch.setattr(
        WorkflowServiceDifyPort,
        "_finish_run",
        lambda *_a, **_kw: (deepcopy(harness.finished), WorkflowRun(graph=json.dumps(historical))),
    )
    result = _run(harness)
    assert result.verification is not None
    evidence = result.verification.execution_evidence
    assert evidence is not None
    assert evidence.failure_phase == "execution"
    assert evidence.failure_resource == ("model", "langgenius/anthropic/anthropic", "actual-model")
    assert evidence.failure_node_ids == ("llm",)
    assert evidence.native_run_id == "native-1"
