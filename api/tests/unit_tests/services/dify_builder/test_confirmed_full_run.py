"""The confirmed full Test Run: the whole draft runs natively, unconfirmed side effects are mocked."""

import json
import pathlib
import threading
from collections.abc import Callable, Generator, Mapping
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
from typing import Never
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine, Table, create_engine, select
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker

from core.dify_builder.input_schema import SYSTEM_QUERY
from core.dify_builder.models import Actor, Graph, NodeOutput, Run
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.model import App, AppMode
from models.tools import BuiltinToolProvider
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowRun,
)
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder import dify_port
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.effect_disclosure import disclose

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
        DifyBuilderSessionCommit,
        DifyBuilderTestInput,
        BuiltinToolProvider,
        TenantAccountJoin,
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
        session.add(TenantAccountJoin(tenant_id=ids["tenant"], account_id=ids["account"], role=TenantAccountRole.OWNER))
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
        session.add(
            DifyBuilderSessionCommit(
                session_id=ids["session"], version=1, state="build.test_and_repair", context={}, actor="test"
            )
        )
        session.add(saved)
    app = App(id=ids["app"], tenant_id=ids["tenant"], mode=AppMode.WORKFLOW)
    draft = Workflow(
        tenant_id="tenant-1",
        graph=json.dumps(GRAPH),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
    )
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
        patch.object(WorkflowServiceDifyPort, "_start_draft_debugger") as generate,
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


def _run(
    harness: FullRunCase,
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
        on_workflow_event=on_workflow_event,
    )


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
    reserve = WorkflowServiceDifyPort._reserve_debugger_run

    class Interrupted(BaseException):
        pass

    def interrupt_after_reservation(
        self: WorkflowServiceDifyPort,
        session_id: str,
        test_input_id: str,
        before_revision: str,
        before_graph_revision: str,
    ) -> Never:
        reserve(self, session_id, test_input_id, before_revision, before_graph_revision)
        raise Interrupted()

    with monkeypatch.context() as interrupted:
        interrupted.setattr(WorkflowServiceDifyPort, "_reserve_debugger_run", interrupt_after_reservation)
        with pytest.raises(Interrupted):
            _run(harness)
    recovered = _run(harness)

    assert recovered.status == "running"
    harness.generate.assert_not_called()


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
        winner.result(timeout=5)

    assert effects == ["sent"]
    assert duplicate.status == "running"
    with harness.factory() as session:
        assert len(list(session.scalars(select(DifyBuilderRun)))) == 1
