import json
import time
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueStopEvent, QueueWorkflowStartedEvent
from core.app.entities.task_entities import WorkflowFinishStreamResponse
from core.workflow.system_variables import build_system_variables
from extensions.ext_redis import RedisClientWrapper
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState
from models.account import Account
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import Workflow, WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from tests.workflow_test_utils import build_test_variable_pool


@pytest.fixture(autouse=True)
def bind_queue_redis(monkeypatch: pytest.MonkeyPatch, redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis_transport[0])


def _build_workflow_app_config() -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-id",
    )


def _build_generate_entity(run_id: str) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity(
        task_id="task-id",
        app_config=_build_workflow_app_config(),
        inputs={},
        files=[],
        user_id="user-id",
        stream=False,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id=run_id,
    )


def _build_runtime_state(run_id: str) -> GraphRuntimeState:
    variable_pool = build_test_variable_pool(variables=build_system_variables(workflow_execution_id=run_id))
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _build_pipeline(run_id: str, session_factory: sessionmaker[Session]) -> WorkflowAppGenerateTaskPipeline:
    queue_manager = WorkflowAppQueueManager(
        task_id="task-id", user_id="user-id", invoke_from=InvokeFrom.SERVICE_API, app_mode=AppMode.WORKFLOW
    )
    queue_manager.graph_runtime_state = _build_runtime_state(run_id)
    workflow = Workflow(
        id="workflow-id",
        tenant_id="tenant-id",
        app_id="app-id",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features=json.dumps({}),
        created_by="user-id",
    )
    user = Account(name="user", email="user@example.com")
    pipeline = WorkflowAppGenerateTaskPipeline(
        application_generate_entity=_build_generate_entity(run_id),
        workflow=workflow,
        queue_manager=queue_manager,
        user=user,
        stream=False,
        draft_var_saver_factory=MagicMock(),
    )

    @contextmanager
    def database_session() -> Generator[Session]:
        with session_factory.begin() as session:
            yield session

    pipeline._database_session = database_session
    return pipeline


def test_workflow_app_log_saved_only_on_initial_start(unbound_session_factory: sessionmaker[Session]) -> None:
    run_id = "run-initial"
    pipeline = _build_pipeline(run_id, unbound_session_factory)
    pipeline._save_workflow_app_log = MagicMock()

    event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.INITIAL)
    list(pipeline._handle_workflow_started_event(event))

    pipeline._save_workflow_app_log.assert_called_once()
    _, kwargs = pipeline._save_workflow_app_log.call_args
    assert kwargs["workflow_run_id"] == run_id
    assert pipeline._workflow_execution_id == run_id


def test_workflow_app_log_skipped_on_resumption_start(unbound_session_factory: sessionmaker[Session]) -> None:
    run_id = "run-resume"
    pipeline = _build_pipeline(run_id, unbound_session_factory)
    pipeline._save_workflow_app_log = MagicMock()

    event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    list(pipeline._handle_workflow_started_event(event))

    pipeline._save_workflow_app_log.assert_not_called()
    assert pipeline._workflow_execution_id == run_id


def test_stop_event_persists_workflow_run_status(sqlite_session_factory: sessionmaker[Session]) -> None:
    run_id = "run-stop"
    pipeline = _build_pipeline(run_id, sqlite_session_factory)

    started_event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    list(pipeline._handle_workflow_started_event(started_event))

    with sqlite_session_factory.begin() as session:
        session.add(
            WorkflowRun(
                id=run_id,
                tenant_id="tenant-id",
                app_id="app-id",
                workflow_id="workflow-id",
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version=Workflow.VERSION_DRAFT,
                status=WorkflowExecutionStatus.RUNNING,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="user-id",
                created_at=datetime(2026, 1, 1),
            )
        )

    stop_event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
    list(pipeline._handle_workflow_failed_and_stop_events(stop_event))

    with sqlite_session_factory() as session:
        workflow_run = session.get(WorkflowRun, run_id)
        assert workflow_run is not None
        assert workflow_run.status == WorkflowExecutionStatus.STOPPED
        assert workflow_run.error == stop_event.get_stop_reason()
        assert workflow_run.finished_at is not None
        assert workflow_run.elapsed_time == (workflow_run.finished_at - workflow_run.created_at).total_seconds()


def test_stop_event_still_yields_finish_when_persistence_fails(
    unbound_session_factory: sessionmaker[Session],
) -> None:
    run_id = "run-stop-persistence-fails"
    pipeline = _build_pipeline(run_id, unbound_session_factory)

    started_event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    list(pipeline._handle_workflow_started_event(started_event))
    stop_event = QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
    responses = list(pipeline._handle_workflow_failed_and_stop_events(stop_event))

    assert len(responses) == 1
    response = responses[0]
    assert isinstance(response, WorkflowFinishStreamResponse)
    assert response.data.status == WorkflowExecutionStatus.STOPPED
    assert response.data.error == stop_event.get_stop_reason()
