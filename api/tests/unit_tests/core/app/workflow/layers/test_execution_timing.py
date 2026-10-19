import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.app.entities.task_entities import WorkflowPauseStreamResponse
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool
from models.account import Account
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from services.workflow.execution.adapters.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter


@pytest.mark.parametrize(
    ("terminal_event", "status"),
    [
        (GraphRunSucceededEvent(), WorkflowExecutionStatus.SUCCEEDED),
        (GraphRunPartialSucceededEvent(exceptions_count=1), WorkflowExecutionStatus.PARTIAL_SUCCEEDED),
        (GraphRunFailedEvent(error="failed"), WorkflowExecutionStatus.FAILED),
        (GraphRunAbortedEvent(reason="stopped"), WorkflowExecutionStatus.STOPPED),
    ],
)
def test_elapsed_time_accumulates_across_pauses_and_matches_delayed_stream_responses(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    terminal_event: GraphRunSucceededEvent | GraphRunPartialSucceededEvent | GraphRunFailedEvent | GraphRunAbortedEvent,
    status: WorkflowExecutionStatus,
) -> None:
    clock = [100.0]
    monkeypatch.setattr("repositories.entities.workflow_execution.perf_counter", lambda: clock[0])
    monkeypatch.setattr(
        "services.workflow.execution.adapters.persistence._inspector_publish_workflow_completed", lambda **_: None
    )
    entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        workflow_execution_id="run-1",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id="tenant-1", app_id="app-1", workflow_id="workflow-1", app_mode=AppMode.WORKFLOW
        ),
        inputs={},
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.SERVICE_API,
    )
    system_variables = build_system_variables(workflow_execution_id="run-1")
    total = 0.0
    account = Account(name="Test", email="test@example.com")
    account.id = "user-1"

    for index, duration in enumerate([2.0, 3.0, 4.0]):
        pool = VariablePool()
        for variable in system_variables:
            pool.add(variable.selector, variable)
        runtime = GraphRuntimeState(variable_pool=pool, start_at=clock[0])
        repository = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=account,
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        node_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=account,
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        layer = WorkflowPersistenceLayer(
            application_generate_entity=entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id="workflow-1", workflow_type=WorkflowType.WORKFLOW, version="1", graph_data={}
            ),
            workflow_execution_repository=repository,
            workflow_node_execution_repository=node_repository,
        )
        layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime), InMemoryChannel())
        layer.on_graph_start()
        reason = WorkflowStartReason.INITIAL if index == 0 else WorkflowStartReason.RESUMPTION
        layer.on_event(GraphRunStartedEvent(reason=reason))
        with sqlite_session_factory() as session:
            started_execution = session.get(WorkflowRun, "run-1")
            assert started_execution is not None
            assert started_execution.elapsed_time == total

        clock[0] += duration
        total += duration
        is_paused = index < 2
        layer.on_event(GraphRunPausedEvent() if is_paused else terminal_event)
        with sqlite_session_factory() as session:
            execution = session.get(WorkflowRun, "run-1")
            assert execution is not None
            assert execution.elapsed_time == total
            assert execution.status == (WorkflowExecutionStatus.PAUSED if is_paused else status)
            assert (execution.finished_at is None) == is_paused

        # Queue processing and pause waits must not extend a settled segment.
        clock[0] += 1000
        converter = WorkflowResponseConverter(
            application_generate_entity=entity,
            user=account,
            system_variables=system_variables,
        )
        converter.workflow_start_to_stream_response(
            task_id="task-1", workflow_run_id="run-1", workflow_id="workflow-1", reason=reason
        )
        if is_paused:
            responses = converter.workflow_pause_to_stream_response(
                event=QueueWorkflowPausedEvent(), task_id="task-1", graph_runtime_state=runtime
            )
            pause_response = responses[-1]
            assert isinstance(pause_response, WorkflowPauseStreamResponse)
            assert pause_response.data.elapsed_time == total
            context = WorkflowResumptionContext(
                generate_entity=_WorkflowGenerateEntityWrapper(entity=entity),
                serialized_graph_runtime_state=runtime.dumps(),
                elapsed_time=total,
            )
            entity = WorkflowResumptionContext.loads(context.dumps()).get_generate_entity()
            assert isinstance(entity, WorkflowAppGenerateEntity)
            assert entity.workflow_execution_timing.elapsed_time == total
        else:
            response = converter.workflow_finish_to_stream_response(
                task_id="task-1", workflow_id="workflow-1", status=status, graph_runtime_state=runtime
            )
            assert response.data.elapsed_time == 9.0
            assert entity.workflow_execution_timing.finish() == 9.0
