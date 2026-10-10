"""Workflow pause orchestration against real Engine, PostgreSQL, Redis, and storage."""

import json
from collections.abc import Mapping
from contextlib import closing
from dataclasses import dataclass
from time import perf_counter
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow_app_runner import PreparedWorkflowRun, WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.system_variables import build_system_variables
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_storage import storage
from graphon.engine.command import InMemoryChannel, PauseCommand
from graphon.engine_events import GraphRunFailedEvent, GraphRunPausedEvent, GraphRunStartedEvent, GraphRunSucceededEvent
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import RuntimeState, VariablePool
from models import Account
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom, WorkflowPause, WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.workflow_run_agg import WorkflowRunAgg


@dataclass
class WorkflowCase:
    session: Session
    engine: Engine
    account: Account
    workflow: Workflow
    run_id: str

    def prepare(
        self,
        *,
        outputs: Mapping[str, object] | None = None,
        variables: Mapping[tuple[str, str], object] | None = None,
        total_tokens: int = 0,
        node_run_steps: int = 0,
        pause: bool = True,
    ) -> tuple[PreparedWorkflowRun, WorkflowRunAgg]:
        entity = WorkflowAppGenerateEntity(
            task_id=str(uuid4()),
            app_config=WorkflowUIBasedAppConfig(
                tenant_id=self.workflow.tenant_id,
                app_id=self.workflow.app_id,
                app_mode=AppMode.WORKFLOW,
                workflow_id=self.workflow.id,
            ),
            inputs={},
            files=[],
            user_id=self.account.id,
            stream=True,
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_execution_id=self.run_id,
        )
        queue = WorkflowAppQueueManager(entity.task_id, self.account.id, entity.invoke_from, AppMode.WORKFLOW)
        runner = WorkflowBasedAppRunner(queue_manager=queue, app_id=self.workflow.app_id)
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                app_id=self.workflow.app_id, workflow_id=self.workflow.id, workflow_execution_id=self.run_id
            )
        )
        for selector, value in (variables or {}).items():
            variable_pool.add(selector, value)
        usage = LLMUsage.empty_usage()
        usage.total_tokens = total_tokens
        runtime = RuntimeState(
            workflow_id=self.workflow.id,
            variable_pool=variable_pool,
            start_at=perf_counter(),
            llm_usage=usage,
            outputs=dict(outputs or {}),
            node_run_steps=node_run_steps,
        )
        graph = runner._init_graph(
            graph_config=self.workflow.graph_dict,
            graph_runtime_state=runtime,
            workflow_id=self.workflow.id,
            tenant_id=self.workflow.tenant_id,
            user_id=self.account.id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        )
        runs = SQLAlchemyWorkflowExecutionRepository(
            self.engine,
            tenant_id=self.workflow.tenant_id,
            user=self.account,
            app_id=self.workflow.app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )
        nodes = SQLAlchemyWorkflowNodeExecutionRepository(
            self.engine,
            tenant_id=self.workflow.tenant_id,
            user=self.account,
            app_id=self.workflow.app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        commands = InMemoryChannel()
        if pause:
            commands.send_command(PauseCommand(reason="integration pause"))
        entry = WorkflowEntry(
            tenant_id=self.workflow.tenant_id,
            app_id=self.workflow.app_id,
            workflow_id=self.workflow.id,
            graph=graph,
            graph_config=self.workflow.graph_dict,
            user_id=self.account.id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
            variable_pool=variable_pool,
            graph_runtime_state=runtime,
            command_channel=commands,
        )
        prepared = PreparedWorkflowRun(entry, WorkflowType.WORKFLOW, self.workflow.version, entity, ())
        aggregate = WorkflowRunAgg(
            prepared,
            runner,
            PauseStateLayerConfig(self.engine, self.workflow.created_by),
            workflow_execution_repository=runs,
            workflow_node_execution_repository=nodes,
        )
        return prepared, aggregate

    def stored_pause(self) -> WorkflowPause:
        self.session.expire_all()
        pause = self.session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == self.run_id))
        assert pause is not None
        return pause


@pytest.fixture
def workflow_case(db_session_with_containers: Session) -> WorkflowCase:
    session = db_session_with_containers
    engine = session.get_bind()
    assert isinstance(engine, Engine)
    tenant = Tenant(name="Pause integration tenant")
    account = Account(name="Pause integration user", email=f"{uuid4()}@example.com")
    session.add_all([tenant, account])
    session.flush()
    session.add(
        TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True)
    )
    graph: dict[str, object] = {
        "nodes": [{"id": "start", "data": StartNodeData(title="Start").model_dump(mode="json")}],
        "edges": [],
    }
    workflow = Workflow(
        id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=str(uuid4()),
        type="workflow",
        version="draft",
        graph=json.dumps(graph),
        features="{}",
        created_by=account.id,
    )
    session.add(workflow)
    session.commit()
    return WorkflowCase(session, engine, account, workflow, str(uuid4()))


def test_complete_pause_flow_with_real_dependencies(workflow_case: WorkflowCase) -> None:
    prepared, aggregate = workflow_case.prepare(outputs={"result": "intermediate"}, total_tokens=100, node_run_steps=5)
    with closing(aggregate.iter_events()) as events:
        assert isinstance(next(events), GraphRunStartedEvent)
        workflow_case.session.expire_all()
        run = workflow_case.session.get(WorkflowRun, workflow_case.run_id)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.RUNNING
        assert workflow_case.session.scalar(select(WorkflowPause)) is None
        remaining = list(events)
    assert isinstance(remaining[-1], GraphRunPausedEvent)
    pause = workflow_case.stored_pause()
    workflow_case.session.refresh(run)
    assert run.status == WorkflowExecutionStatus.PAUSED
    assert run.finished_at is None
    assert run.outputs_dict == {"result": "intermediate"}
    assert run.total_tokens == 100
    assert run.total_steps == prepared.entry.graph_engine.runtime_state.node_run_steps
    assert pause.workflow_id == workflow_case.workflow.id
    assert pause.resumed_at is None
    snapshot = WorkflowResumptionContext.loads(storage.load(pause.state_object_key).decode())
    assert snapshot.serialized_graph_runtime_state == prepared.entry.graph_engine.runtime_state.dumps()
    assert snapshot.get_response_stream_filter().dumps() == prepared.entry.response_stream_filter.dumps()
    entity = snapshot.get_generate_entity()
    assert isinstance(entity, WorkflowAppGenerateEntity)
    assert entity.workflow_execution_id == workflow_case.run_id


def test_state_persistence_and_retrieval(workflow_case: WorkflowCase) -> None:
    outputs = {"nested": {"key": "value", "number": 42}, "list": [1, 2, 3, {"nested": "item"}], "null": None}
    variables = {("node", "text"): "value", ("node", "object"): {"complex": "object"}, ("node", "list"): [1, 2, 3]}
    prepared, aggregate = workflow_case.prepare(
        outputs=outputs, variables=variables, total_tokens=250, node_run_steps=10
    )
    events = list(aggregate.iter_events())
    assert isinstance(events[-1], GraphRunPausedEvent)
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sessionmaker(workflow_case.engine))
    pause = repository.get_workflow_pause(workflow_case.run_id)
    assert pause is not None
    assert pause.workflow_execution_id == workflow_case.run_id
    assert pause.get_pause_reasons() == events[-1].reasons
    snapshot = WorkflowResumptionContext.loads(pause.get_state().decode())
    restored = RuntimeState.from_snapshot(snapshot.serialized_graph_runtime_state)
    assert restored.outputs == outputs
    assert restored.total_tokens == 250
    assert restored.node_run_steps == prepared.entry.graph_engine.runtime_state.node_run_steps
    for selector, expected in variables.items():
        variable = restored.variable_pool.get(selector)
        assert variable is not None
        assert variable.to_object() == expected


def test_database_transaction_handling(workflow_case: WorkflowCase) -> None:
    _, aggregate = workflow_case.prepare(outputs={"test": "transaction"})
    assert isinstance(list(aggregate.iter_events())[-1], GraphRunPausedEvent)
    with Session(workflow_case.engine) as session:
        run = session.get(WorkflowRun, workflow_case.run_id)
        assert run is not None
        assert run.status == WorkflowExecutionStatus.PAUSED
        pause = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == run.id))
        assert pause is not None
        assert pause.resumed_at is None
        assert storage.load(pause.state_object_key)


def test_workflow_with_different_creators(workflow_case: WorkflowCase) -> None:
    creator = Account(name="Workflow creator", email=f"{uuid4()}@example.com")
    workflow_case.session.add(creator)
    workflow_case.session.flush()
    workflow_case.workflow.created_by = creator.id
    workflow_case.session.commit()
    _, aggregate = workflow_case.prepare()
    assert isinstance(list(aggregate.iter_events())[-1], GraphRunPausedEvent)
    pause = workflow_case.stored_pause()
    snapshot = WorkflowResumptionContext.loads(storage.load(pause.state_object_key).decode())
    run = workflow_case.session.get(WorkflowRun, workflow_case.run_id)
    assert run is not None
    assert run.created_by == workflow_case.account.id
    assert run.created_by != workflow_case.workflow.created_by
    assert snapshot.get_generate_entity().user_id == workflow_case.account.id


def test_successful_execution_creates_no_pause(workflow_case: WorkflowCase) -> None:
    _, aggregate = workflow_case.prepare(pause=False)
    events = list(aggregate.iter_events())
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert not any(isinstance(event, GraphRunPausedEvent) for event in events)
    workflow_case.session.expire_all()
    run = workflow_case.session.get(WorkflowRun, workflow_case.run_id)
    assert run is not None
    assert run.status == WorkflowExecutionStatus.SUCCEEDED
    assert workflow_case.session.scalar(select(WorkflowPause)) is None


def test_active_execution_cannot_publish_a_durable_pause(workflow_case: WorkflowCase) -> None:
    prepared, aggregate = workflow_case.prepare()
    with prepared.entry.graph_engine.runtime_state.graph_execution.track_execution():
        events = list(aggregate.iter_events())
    assert isinstance(events[-1], GraphRunFailedEvent)
    assert "during active execution" in events[-1].error
    assert not any(isinstance(event, GraphRunPausedEvent) for event in events)
    workflow_case.session.expire_all()
    run = workflow_case.session.get(WorkflowRun, workflow_case.run_id)
    assert run is not None
    assert run.status == WorkflowExecutionStatus.FAILED
    assert workflow_case.session.scalar(select(WorkflowPause)) is None
