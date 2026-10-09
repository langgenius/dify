"""Human Input nodes persist through the execution's injected database."""

import json
from collections.abc import Iterator
from datetime import timedelta
from typing import cast

import pytest
from sqlalchemy import Table, create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.entities.app_invoke_entities import InvokeFrom
from core.db import session_factory
from core.workflow.system_variables import build_system_variables
from enums.human_input import HumanInputFormStatus, RecipientType
from extensions.application_services.workflow import build_workflow_execution_dependencies
from extensions.application_services.workflow_variables import build_workflow_variable_service
from graphon.graph_engine import GraphEngine
from graphon.graph_events import NodeRunSucceededEvent
from graphon.node_events import PauseRequestedEvent, StreamCompletedEvent
from graphon.runtime import GraphRuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.base import TypeBase
from models.human_input import HumanInputDelivery, HumanInputForm, HumanInputFormRecipient
from models.human_input_entities import HumanInputNodeData, UserActionConfig
from services.workflow.execution.adapters.node_factory import DifyNodeFactory
from services.workflow.execution.ports import WorkflowRuntime
from tasks.app_generate.workflow_execute_task import AppExecutionParams, _Account, _AppRunner
from tests.workflow_test_utils import build_test_graph_init_params

type FormDatabases = tuple[sessionmaker[Session], sessionmaker[Session]]


@pytest.fixture(params=[False, True], ids=["retain-after-commit", "expire-after-commit"])
def form_databases(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> Iterator[FormDatabases]:
    engines = [create_engine("sqlite://", poolclass=QueuePool) for _ in range(2)]
    for engine in engines:
        tables: list[Table] = []
        for model in (HumanInputForm, HumanInputDelivery, HumanInputFormRecipient):
            table = model.__table__
            assert isinstance(table, Table)
            tables.append(table)
        TypeBase.metadata.create_all(engine, tables=tables)
    injected, global_sessions = [sessionmaker(engine, expire_on_commit=bool(request.param)) for engine in engines]
    monkeypatch.setattr(session_factory, "create_session", global_sessions)
    try:
        yield injected, global_sessions
    finally:
        for engine in engines:
            engine.dispose()


def factory(runtime: WorkflowRuntime | None, invoke_from: InvokeFrom = InvokeFrom.DEBUGGER) -> DifyNodeFactory:
    state = GraphRuntimeState(
        variable_pool=VariablePool.from_bootstrap(
            system_variables=build_system_variables(app_id="app", workflow_execution_id="run")
        ),
        start_at=0,
    )
    return DifyNodeFactory(
        graph_init_params=build_test_graph_init_params(invoke_from=invoke_from),
        graph_runtime_state=state,
        workflow_runtime=runtime,
    )


def node_config() -> dict[str, object]:
    return {
        "id": "human-node",
        "data": HumanInputNodeData(
            title="Approval",
            form_content="Approve this request?",
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ).model_dump(),
    }


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API])
@pytest.mark.parametrize("rebind", [False, True])
@pytest.mark.parametrize("entry", ["factory", "engine-worker"])
def test_node_creates_and_resumes_form_in_injected_database(
    form_databases: FormDatabases, invoke_from: InvokeFrom, rebind: bool, entry: str
) -> None:
    sessions, global_sessions = form_databases
    if entry == "engine-worker":
        runner = _AppRunner(
            sessions.kw["bind"],
            AppExecutionParams(
                app_id="app",
                workflow_id="workflow",
                tenant_id="tenant",
                user=_Account(user_id="user"),
                args={},
                invoke_from=invoke_from,
            ),
            variables=build_workflow_variable_service(database_client=sessions),
        )
        assert runner._session_factory.kw["expire_on_commit"] is True
        runtime = runner._runtime
    else:
        runtime = build_workflow_execution_dependencies(sessions)
    node_factory = factory(runtime, invoke_from)
    if rebind:
        node_factory = node_factory.with_runtime_state(node_factory.graph_runtime_state)
    node = node_factory.create_node(node_config())
    node.bind_execution_id("human-execution")
    events = list(node._run())
    assert any(isinstance(event, PauseRequestedEvent) for event in events)
    assert sessions.kw["bind"].pool.checkedout() == 0
    assert global_sessions.kw["bind"].pool.checkedout() == 0

    with sessions.begin() as session:
        form = session.scalars(select(HumanInputForm)).one()
        assert (form.tenant_id, form.app_id, form.workflow_run_id, form.node_id) == (
            "tenant",
            "app",
            "run",
            "human-node",
        )
        form_id = form.id
        recipients = session.scalars(select(HumanInputFormRecipient)).all()
        if invoke_from == InvokeFrom.DEBUGGER:
            console = next(recipient for recipient in recipients if recipient.recipient_type == RecipientType.CONSOLE)
            assert json.loads(console.recipient_payload)["account_id"] == "user"
        form.selected_action_id = "approve"
        form.submitted_data = "{}"
        form.submitted_at = naive_utc_now()
        form.expiration_time = naive_utc_now() + timedelta(hours=1)
        form.status = HumanInputFormStatus.SUBMITTED

    completed = list(node._run())
    assert not any(isinstance(event, PauseRequestedEvent) for event in completed)
    assert isinstance(completed[-1], StreamCompletedEvent)
    assert completed[-1].node_run_result.outputs["__action_id"].value == "approve"
    with sessions() as session:
        assert session.scalars(select(HumanInputForm)).one().id == form_id
    with global_sessions() as session:
        assert session.scalar(select(HumanInputForm)) is None
    assert sessions.kw["bind"].pool.checkedout() == 0


def test_human_input_node_requires_persistence_dependency() -> None:
    with pytest.raises(ValueError, match="execution dependencies are required for Human Input"):
        factory(None).create_node(node_config())


def test_create_form_commit_failure_does_not_return_a_pause_or_persist_form(
    form_databases: FormDatabases,
) -> None:
    sessions, _ = form_databases
    node = factory(build_workflow_execution_dependencies(sessions)).create_node(node_config())
    node.bind_execution_id("human-execution")

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sessions, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            list(node._run())
    finally:
        event.remove(sessions, "before_commit", fail_commit)
    with sessions() as session:
        assert session.scalar(select(HumanInputForm)) is None
        assert session.scalar(select(HumanInputFormRecipient)) is None
        assert session.scalar(select(HumanInputDelivery)) is None


def test_created_form_timeout_reaches_event_stream_in_same_database(form_databases: FormDatabases) -> None:
    from dataclasses import dataclass

    from graphon.graph import Graph
    from graphon.graph_events import NodeRunHumanInputFormTimeoutEvent
    from services.workflow.execution.adapters.workflow_entry import iter_dify_graph_engine_events

    sessions, global_sessions = form_databases
    runtime = build_workflow_execution_dependencies(sessions)
    node = factory(runtime).create_node(node_config())
    node.bind_execution_id("timed-out-execution")
    assert any(isinstance(event, PauseRequestedEvent) for event in node._run())
    deadline = naive_utc_now() - timedelta(minutes=1)
    with sessions.begin() as session:
        form = session.scalars(select(HumanInputForm)).one()
        form.expiration_time = deadline
        form.status = HumanInputFormStatus.TIMEOUT

    @dataclass
    class NodeEvents:
        graph: Graph
        graph_runtime_state: GraphRuntimeState

        def run(self) -> Iterator[object]:
            yield from node.run()

    events = list(
        iter_dify_graph_engine_events(
            cast(GraphEngine, NodeEvents(Graph(root_node=node), node.graph_runtime_state)),
            human_form_reader=runtime.human_form_reader,
        )
    )
    timeout = next(event for event in events if isinstance(event, NodeRunHumanInputFormTimeoutEvent))
    assert timeout.id == "timed-out-execution"
    assert timeout.expiration_time == deadline
    assert isinstance(events[-1], NodeRunSucceededEvent)
    with global_sessions() as session:
        assert session.scalar(select(HumanInputForm)) is None
    assert sessions.kw["bind"].pool.checkedout() == 0
